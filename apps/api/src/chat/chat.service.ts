import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MultipartFile } from "@fastify/multipart";
import { fileTypeFromBuffer } from "file-type";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  formatChatIntakeMessage,
  ChatMessageCreateSchema,
  ChatThreadCreateSchema,
  ROLE_PERMISSIONS,
  chatNumberLabel,
  type ChatThreadCreate,
  type Permission,
} from "@an30/contracts";

import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import { CryptoService } from "../security/crypto.service.js";
import {
  MalwareDetectedError,
  MalwareScannerService,
  MalwareScannerUnavailableError,
} from "../security/malware-scanner.service.js";
import {
  InvalidMediaError,
  MediaValidationService,
  MediaValidatorUnavailableError,
} from "../security/media-validation.service.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import type { ChatIdentity, ChatMessageView } from "./chat.types.js";

const UUID = z.uuid();
const GUEST_THREAD_SCOPE = "chat-thread:guest";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// ffmpeg runs inside the 1.5 GiB API container. A non-blocking, process-wide
// admission slot prevents a burst of otherwise rate-limited guest uploads
// from retaining many 15 MiB buffers and spawning decoders concurrently.
const MAX_CONCURRENT_ATTACHMENT_PROCESSING = 1;
const MAX_CONCURRENT_ATTACHMENT_RECEIVES = 8;
const ATTACHMENT_RECEIVE_TIMEOUT_MS = 30_000;
const ALLOWED_ATTACHMENTS = new Map<string, { extension: string; maxBytes: number }>([
  ["image/jpeg", { extension: "jpg", maxBytes: 5 * 1024 * 1024 }],
  ["image/png", { extension: "png", maxBytes: 5 * 1024 * 1024 }],
  ["image/webp", { extension: "webp", maxBytes: 5 * 1024 * 1024 }],
  ["video/mp4", { extension: "mp4", maxBytes: MAX_ATTACHMENT_BYTES }],
  ["video/quicktime", { extension: "mov", maxBytes: MAX_ATTACHMENT_BYTES }],
  ["video/webm", { extension: "webm", maxBytes: MAX_ATTACHMENT_BYTES }],
]);

interface ThreadRow {
  assigned_staff_id: string | null;
  manager_wait_since?: Date | null;
  created_at: Date;
  customer_user_id: string | null;
  guest_token_hash: Buffer | null;
  id: string;
  last_message_at: Date | null;
  order_id: string | null;
  /** Sequential human-readable number (migration 0039), shown as «Ч-000123». */
  public_number?: string | number | null;
  status: "closed" | "open" | "waiting_customer" | "waiting_staff";
  subject: string | null;
}

interface MessageRow {
  attachments: unknown;
  body: string | null;
  client_message_id: string | null;
  created_at: Date;
  id: string;
  message_type: "attachment" | "system" | "text";
  reply_to_id: string | null;
  sender_kind: "customer" | "guest" | "staff" | "system";
  sender_user_id: string | null;
  sequence_number: string;
  thread_id: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private activeAttachmentProcessing = 0;
  private activeAttachmentReceives = 0;

  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly events: ChatEventBus,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly malwareScanner: MalwareScannerService,
    private readonly mediaValidation: MediaValidationService,
  ) {}

  async createForCustomer(body: unknown, auth: AuthContext) {
    const input = this.parseThread(body);
    if (input.orderId) {
      const order = await this.database.query(
        "SELECT 1 FROM app.orders WHERE id=$1 AND user_id=$2",
        [input.orderId, auth.userId],
      );
      if (order.rowCount === 0) throw new NotFoundException("Заказ не найден");
    }
    const sender = this.sender({ auth, kind: "authenticated" });
    const result = await this.database.transaction((client) => this.createThreadOnce(client, `chat-thread:user:${auth.userId}`, input, async () => {
      const thread = (await client.query<ThreadRow>(
        `INSERT INTO app.chat_threads (customer_user_id,order_id,subject)
         VALUES ($1,$2,$3) RETURNING *`,
        [auth.userId, input.orderId, input.subject],
      )).rows[0]!;
      await client.query(
        "INSERT INTO app.chat_participants (thread_id,user_id) VALUES ($1,$2)",
        [thread.id, auth.userId],
      );
      // The intake questionnaire answers become the thread's first message
      // — the manager's opening context, not data collected and dropped —
      // and, since it is a genuine customer message, it is what starts the
      // ten-minute reply countdown (see unansweredSince in chat-state.ts).
      await this.insertMessage(
        client,
        thread.id,
        sender,
        { body: formatChatIntakeMessage(input.intake), clientMessageId: randomUUID(), replyToId: null },
        "text",
      );
      return thread;
    }));
    return this.threadView(result);
  }

  async createForGuest(body: unknown, guestOrderToken: string | undefined) {
    const input = this.parseThread(body);
    if (input.orderId) {
      if (!guestOrderToken || guestOrderToken.length < 32 || guestOrderToken.length > 256) {
        throw new NotFoundException("Заказ не найден");
      }
      const order = await this.database.query(
        `SELECT 1 FROM app.orders AS checkout_order
         WHERE checkout_order.id=$1 AND checkout_order.user_id IS NULL
           AND checkout_order.guest_token_hash=$2`,
        [input.orderId, this.crypto.opaqueHash("guest-order-access", guestOrderToken)],
      );
      if (order.rowCount === 0) throw new NotFoundException("Заказ не найден");
    }
    // A repeated request must hand back the same access token, and only its
    // hash is stored: with a request id the token is derived from it (as the
    // guest order token is in checkout), without one it is random.
    const guestToken = input.clientRequestId
      ? this.crypto.deriveOpaqueToken("guest-chat-access", `${GUEST_THREAD_SCOPE}\0${input.clientRequestId}`)
      : this.crypto.randomToken();
    const result = await this.database.transaction((client) => this.createThreadOnce(client, GUEST_THREAD_SCOPE, input, async () => {
      const thread = (await client.query<ThreadRow>(
        `INSERT INTO app.chat_threads (guest_token_hash,order_id,subject)
         VALUES ($1,$2,$3) RETURNING *`,
        [this.crypto.opaqueHash("guest-chat-access", guestToken), input.orderId, input.subject],
      )).rows[0]!;
      // See createForCustomer above: same reasoning, guest sender.
      await this.insertMessage(
        client,
        thread.id,
        { kind: "guest", userId: null },
        { body: formatChatIntakeMessage(input.intake), clientMessageId: randomUUID(), replyToId: null },
        "text",
      );
      return thread;
    }));
    return { ...this.threadView(result), guestToken };
  }

  /**
   * Opens a chat once per `clientRequestId`: a double click, a retry after a
   * lost response or a replayed raw request gets the chat the first request
   * opened. Without an id every request opens a chat (the per-address limit
   * in the controller still applies).
   */
  private async createThreadOnce(
    client: PoolClient,
    scope: string,
    input: ChatThreadCreate,
    create: () => Promise<ThreadRow>,
  ): Promise<ThreadRow> {
    if (!input.clientRequestId) return create();
    const checksum = createHash("sha256").update(JSON.stringify(input), "utf8").digest();
    // A concurrent request with the same id waits here until the first commits.
    await client.query(
      `INSERT INTO app.idempotency_keys (scope,key,request_hash,resource_type,locked_until,expires_at)
       VALUES ($1,$2,$3,'chat_thread',clock_timestamp() + interval '30 seconds',clock_timestamp() + interval '24 hours')
       ON CONFLICT (scope,key) DO NOTHING`,
      [scope, input.clientRequestId, checksum],
    );
    const key = (await client.query<{ request_hash: Buffer; resource_id: string | null }>(
      "SELECT request_hash,resource_id FROM app.idempotency_keys WHERE scope=$1 AND key=$2 FOR UPDATE",
      [scope, input.clientRequestId],
    )).rows[0];
    if (!key) throw new ConflictException("Не удалось зафиксировать повторный запрос");
    if (key.request_hash.length !== checksum.length || !timingSafeEqual(key.request_hash, checksum)) {
      throw new ConflictException("Этот запрос уже отправлен с другими данными");
    }
    if (key.resource_id) {
      const existing = (await client.query<ThreadRow>(
        "SELECT * FROM app.chat_threads WHERE id=$1 AND deleted_at IS NULL", [key.resource_id],
      )).rows[0];
      if (existing) return existing;
    }
    const thread = await create();
    await client.query(
      "UPDATE app.idempotency_keys SET resource_id=$3,completed_at=clock_timestamp() WHERE scope=$1 AND key=$2",
      [scope, input.clientRequestId, thread.id],
    );
    return thread;
  }

  async list(auth: AuthContext) {
    const staff = auth.role !== "customer";
    const granted: readonly Permission[] = ROLE_PERMISSIONS[auth.role];
    if (staff && !granted.includes("chat:manage:any")) {
      throw new ForbiddenException("Недостаточно прав");
    }
    const result = await this.database.query<ThreadRow>(
      `SELECT * FROM app.chat_threads
       WHERE deleted_at IS NULL AND ($1::boolean OR customer_user_id=$2)
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 100`,
      [staff, auth.userId],
    );
    return { items: result.rows.map((row) => this.threadView(row)) };
  }

  async history(
    threadId: string,
    after: string | undefined,
    identity: ChatIdentity,
    pagination: { before?: string; limit?: string } = {},
  ) {
    const thread = await this.authorize(threadId, identity);
    if (after !== undefined && pagination.before !== undefined) {
      throw new BadRequestException("Нельзя одновременно использовать after и before");
    }
    const limit = this.parseHistoryLimit(pagination.limit);
    if (pagination.before !== undefined) {
      const latest = pagination.before === "latest";
      const before = latest ? null : this.parseCursor(pagination.before);
      const result = await this.database.query<MessageRow>(
        `${this.messageSelect()}
         WHERE message.thread_id=$1
           AND ($2::bigint IS NULL OR message.sequence_number<$2::bigint)
           AND message.deleted_at IS NULL
         ORDER BY message.sequence_number DESC LIMIT $3`,
        [threadId, before, limit + 1],
      );
      const hasOlder = result.rows.length > limit;
      const rows = result.rows.slice(0, limit).reverse();
      await this.markDelivered(rows, identity);
      return {
        items: rows.map((row) => this.messageView(row)),
        nextSequence: rows.at(-1)?.sequence_number ?? "0",
        olderCursor: hasOlder ? rows[0]?.sequence_number ?? null : null,
        thread: await this.threadAssignmentView(thread),
      };
    }
    const cursor = this.parseCursor(after);
    const result = await this.database.query<MessageRow>(
      `${this.messageSelect()}
       WHERE message.thread_id=$1 AND message.sequence_number>$2 AND message.deleted_at IS NULL
       ORDER BY message.sequence_number LIMIT $3`,
      [threadId, cursor, limit],
    );
    await this.markDelivered(result.rows, identity);
    return {
      items: result.rows.map((row) => this.messageView(row)),
      nextSequence: result.rows.at(-1)?.sequence_number ?? cursor,
      olderCursor: null,
      thread: await this.threadAssignmentView(thread),
    };
  }

  async createMessage(threadId: string, body: unknown, identity: ChatIdentity) {
    const input = ChatMessageCreateSchema.safeParse(body);
    if (!input.success) {
      throw new BadRequestException({ error: "invalid_chat_message", issues: input.error.issues });
    }
    const thread = await this.authorize(threadId, identity);
    if (thread.status === "closed") throw new ConflictException("Чат закрыт");
    const sender = this.sender(identity);
    const row = await this.database.transaction((client) => this.insertMessage(
      client,
      threadId,
      sender,
      input.data,
      "text",
    ));
    const view = this.messageView(row);
    await this.events.publish({ payload: { message: view, type: "message" }, threadId });
    return view;
  }

  async markRead(threadId: string, messageId: string, identity: ChatIdentity) {
    this.parseUuid(messageId, "Некорректный идентификатор сообщения");
    await this.authorize(threadId, identity);
    const message = (await this.database.query<{ sequence_number: string }>(
      "SELECT sequence_number FROM app.chat_messages WHERE id=$1 AND thread_id=$2 AND deleted_at IS NULL",
      [messageId, threadId],
    )).rows[0];
    if (!message) throw new NotFoundException("Сообщение не найдено");
    if (identity.kind === "guest") {
      await this.database.query(
        `INSERT INTO app.chat_guest_message_receipts (message_id,delivered_at,read_at)
         SELECT candidate.id,clock_timestamp(),clock_timestamp()
         FROM app.chat_messages AS candidate
         WHERE candidate.thread_id=$1 AND candidate.sequence_number<=$2::bigint
           AND candidate.deleted_at IS NULL AND candidate.sender_kind<>'guest'
         ON CONFLICT (message_id) DO UPDATE
         SET delivered_at=COALESCE(app.chat_guest_message_receipts.delivered_at,EXCLUDED.delivered_at),
             read_at=COALESCE(app.chat_guest_message_receipts.read_at,EXCLUDED.read_at)`,
        [threadId, message.sequence_number],
      );
    } else {
      await this.database.query(
        `INSERT INTO app.chat_message_receipts (message_id,user_id,delivered_at,read_at)
         SELECT candidate.id,$3,clock_timestamp(),clock_timestamp()
         FROM app.chat_messages AS candidate
         WHERE candidate.thread_id=$1 AND candidate.sequence_number<=$2::bigint
           AND candidate.deleted_at IS NULL
           AND candidate.sender_user_id IS DISTINCT FROM $3::uuid
         ON CONFLICT (message_id,user_id) DO UPDATE
         SET delivered_at=COALESCE(app.chat_message_receipts.delivered_at,EXCLUDED.delivered_at),
             read_at=COALESCE(app.chat_message_receipts.read_at,EXCLUDED.read_at)`,
        [threadId, message.sequence_number, identity.auth.userId],
      );
      await this.database.query(
        "UPDATE app.chat_participants SET last_read_at=clock_timestamp() WHERE thread_id=$1 AND user_id=$2",
        [threadId, identity.auth.userId],
      );
    }
    const payload = {
      messageId,
      readerKind: identity.kind === "guest" ? "guest" : identity.auth.role === "customer" ? "customer" : "staff",
      readAt: new Date().toISOString(),
      type: "receipt.read",
    };
    await this.events.publish({ payload, threadId });
    return payload;
  }

  async uploadAttachment(
    threadId: string,
    clientMessageId: string | undefined,
    file: MultipartFile | undefined,
    identity: ChatIdentity,
    signal?: AbortSignal,
  ) {
    const parsedClientId = z.uuid().safeParse(clientMessageId);
    if (!parsedClientId.success) throw new BadRequestException("Требуется корректный x-client-message-id");
    if (!file) throw new BadRequestException("Файл не передан");
    const thread = await this.authorize(threadId, identity);
    if (thread.status === "closed") throw new ConflictException("Чат закрыт");

    // Receiving bytes must not monopolize the one expensive scan/decode slot.
    // Both stages have their own admission limit; slow senders have a deadline.
    const content = await this.receiveAttachment(file, signal);
    const releaseProcessingSlot = this.acquireAttachmentProcessingSlot();
    try {
    if (content.length === 0 || content.length > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException("Допустимый размер файла: от 1 байта до 15 МБ");
    }
    const detected = await fileTypeFromBuffer(content);
    const attachmentType = detected ? ALLOWED_ATTACHMENTS.get(detected.mime) : undefined;
    if (!detected || !attachmentType || file.mimetype !== detected.mime) {
      throw new BadRequestException("Разрешены JPEG, PNG, WebP, MP4, MOV и WebM с корректной сигнатурой");
    }
    if (content.length > attachmentType.maxBytes) {
      const limit = detected.mime.startsWith("image/") ? "5 МБ" : "15 МБ";
      throw new BadRequestException(`Максимальный размер этого файла: ${limit}`);
    }
    try {
      await this.malwareScanner.assertClean(content);
    } catch (error) {
      if (error instanceof MalwareDetectedError) {
        throw new BadRequestException("Файл отклонён проверкой безопасности");
      }
      if (error instanceof MalwareScannerUnavailableError) {
        throw new ServiceUnavailableException("Проверка файлов временно недоступна");
      }
      throw error;
    }
    try {
      await this.mediaValidation.assertValid(content, detected.mime);
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        if (error.reason === "duration") {
          throw new BadRequestException("Видео должно быть не длиннее 2 минут");
        }
        if (error.reason === "timeout") {
          throw new ServiceUnavailableException("Проверка видео заняла слишком много времени. Повторите попытку");
        }
        throw new BadRequestException("Файл повреждён или содержит неподдерживаемый медиаконтейнер");
      }
      if (error instanceof MediaValidatorUnavailableError) {
        throw new ServiceUnavailableException("Проверка медиаконтейнера временно недоступна");
      }
      throw error;
    }
    const { extension } = attachmentType;
    const originalName = this.safeOriginalName(file.filename);
    const sha256 = createHash("sha256").update(content).digest();
    const stored = await this.storage.store(content, extension);
    let removeNewObject = false;
    let result: MessageRow;
    try {
      result = await this.database.transaction(async (client) => {
        const lockedThread = await client.query<{ status: ThreadRow["status"] }>(
          `SELECT status FROM app.chat_threads
           WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
          [threadId],
        );
        if (lockedThread.rows[0]?.status === "closed" || lockedThread.rowCount === 0) {
          throw new ConflictException("Чат закрыт");
        }
        const object = (await client.query<{ id: string; status: string; storage_key: string }>(
          `INSERT INTO app.storage_objects
             (provider,storage_key,original_name,mime_type,byte_size,sha256,status,owner_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,'available',$7)
           ON CONFLICT (provider,sha256,byte_size) DO UPDATE SET
             storage_key=CASE WHEN app.storage_objects.status='deleted'
               THEN EXCLUDED.storage_key ELSE app.storage_objects.storage_key END,
             original_name=CASE WHEN app.storage_objects.status='deleted'
               THEN EXCLUDED.original_name ELSE app.storage_objects.original_name END,
             mime_type=CASE WHEN app.storage_objects.status='deleted'
               THEN EXCLUDED.mime_type ELSE app.storage_objects.mime_type END,
             status=CASE WHEN app.storage_objects.status='deleted'
               THEN 'available'::app.storage_status ELSE app.storage_objects.status END,
             deleted_at=CASE WHEN app.storage_objects.status='deleted'
               THEN NULL ELSE app.storage_objects.deleted_at END,
             updated_at=clock_timestamp()
           RETURNING id,storage_key,status::text`,
          [
            this.storage.name,
            stored.storageKey,
            `attachment.${extension}`,
            detected.mime,
            content.length,
            sha256,
            identity.kind === "authenticated" ? identity.auth.userId : null,
          ],
        )).rows[0]!;
        removeNewObject = object.storage_key !== stored.storageKey;
        if (object.status !== "available") {
          throw new ConflictException("Файл с таким содержимым временно недоступен");
        }
        const message = await this.insertMessage(
          client,
          threadId,
          this.sender(identity),
          { body: originalName, clientMessageId: parsedClientId.data, replyToId: null },
          "attachment",
        );
        const existing = (await client.query<{ sha256: Buffer }>(
          `SELECT storage.sha256 FROM app.chat_attachments AS attachment
           JOIN app.storage_objects AS storage ON storage.id=attachment.storage_object_id
           WHERE attachment.message_id=$1`,
          [message.id],
        )).rows[0];
        if (existing && !existing.sha256.equals(sha256)) {
          throw new ConflictException("Этот client message id уже использован для другого файла");
        }
        if (!existing) {
          await client.query(
            `INSERT INTO app.chat_attachments (message_id,storage_object_id,scan_status)
             VALUES ($1,$2,'clean')`,
            [message.id, object.id],
          );
        }
        return (await client.query<MessageRow>(
          `${this.messageSelect()} WHERE message.id=$1`, [message.id],
        )).rows[0]!;
      });
    } catch (error) {
      await this.removeStoredObject(stored.storageKey);
      throw error;
    }
    if (removeNewObject) await this.removeStoredObject(stored.storageKey);
    const view = this.messageView(result);
    try {
      await this.events.publish({ payload: { message: view, type: "message" }, threadId });
    } catch (error) {
      // The message and storage reference have already committed. Realtime is
      // best effort here; deleting the object would corrupt a successful
      // upload. Cursor history remains the durable recovery path.
      this.logger.warn(`Chat attachment event publish failed: ${this.errorMessage(error)}`);
    }
      return view;
    } finally {
      releaseProcessingSlot();
    }
  }

  async readAttachment(attachmentId: string, identity: ChatIdentity) {
    this.parseUuid(attachmentId, "Некорректный идентификатор вложения");
    const attachment = (await this.database.query<{
      byte_size: string;
      mime_type: string;
      original_name: string;
      scan_status: string;
      storage_key: string;
      thread_id: string;
    }>(
      `SELECT message.thread_id,storage.storage_key,message.body AS original_name,storage.mime_type,
              storage.byte_size::text,attachment.scan_status::text
       FROM app.chat_attachments AS attachment
       JOIN app.chat_messages AS message ON message.id=attachment.message_id
       JOIN app.storage_objects AS storage ON storage.id=attachment.storage_object_id
       WHERE attachment.id=$1 AND attachment.scan_status='clean'
         AND message.deleted_at IS NULL
         AND storage.status='available' AND storage.deleted_at IS NULL`,
      [attachmentId],
    )).rows[0];
    if (!attachment) throw new NotFoundException("Вложение не найдено");
    await this.authorize(attachment.thread_id, identity);
    if (!this.storage.open) {
      throw new ServiceUnavailableException("Хранилище не поддерживает потоковую выдачу");
    }
    let opened;
    try {
      opened = await this.storage.open(attachment.storage_key);
    } catch {
      throw new NotFoundException("Вложение повреждено");
    }
    if (opened.byteSize !== Number(attachment.byte_size)) {
      opened.content.destroy();
      throw new NotFoundException("Вложение повреждено");
    }
    return {
      byteSize: opened.byteSize,
      content: opened.content,
      mimeType: attachment.mime_type,
      originalName: attachment.original_name,
    };
  }

  async authorize(threadId: string, identity: ChatIdentity): Promise<ThreadRow> {
    this.parseUuid(threadId, "Некорректный идентификатор чата");
    const thread = (await this.database.query<ThreadRow>(
      "SELECT * FROM app.chat_threads WHERE id=$1 AND deleted_at IS NULL",
      [threadId],
    )).rows[0];
    if (!thread) throw new NotFoundException("Чат не найден");
    if (identity.kind === "guest") {
      if (!thread.guest_token_hash || !this.validGuestToken(identity.guestToken, thread.guest_token_hash)) {
        throw new NotFoundException("Чат не найден");
      }
      return thread;
    }
    const auth = identity.auth;
    if (auth.role === "customer" && thread.customer_user_id !== auth.userId) {
      throw new NotFoundException("Чат не найден");
    }
    const granted: readonly Permission[] = ROLE_PERMISSIONS[auth.role];
    if (auth.role !== "customer" && !granted.includes("chat:manage:any")) {
      throw new ForbiddenException("Недостаточно прав");
    }
    return thread;
  }

  /**
   * Lightweight snapshot used by ChatAssistantService to decide whether to
   * post an automated reply at all: skipped entirely for a closed thread or
   * one a human has already taken (see ChatAssistantService.respond).
   */
  async threadAssignment(
    threadId: string,
  ): Promise<{ assignedStaffId: string | null; status: ThreadRow["status"] } | null> {
    const thread = (await this.database.query<Pick<ThreadRow, "assigned_staff_id" | "status">>(
      "SELECT assigned_staff_id, status FROM app.chat_threads WHERE id=$1 AND deleted_at IS NULL",
      [threadId],
    )).rows[0];
    if (!thread) return null;
    return { assignedStaffId: thread.assigned_staff_id, status: thread.status };
  }

  /** Whether the assistant has already answered this customer message. */
  async assistantAnswered(
    threadId: string,
    replyToId: string,
    client?: PoolClient,
  ): Promise<boolean> {
    const sql = `SELECT 1 FROM app.chat_messages
       WHERE thread_id=$1 AND reply_to_id=$2 AND sender_kind='system' LIMIT 1`;
    const values = [threadId, replyToId];
    const answered = client ? await client.query(sql, values) : await this.database.query(sql, values);
    return (answered.rowCount ?? 0) > 0;
  }

  /**
   * Stores one automated assistant reply as a real chat message, attributed
   * as `sender_kind='system'` (never 'staff') so it is never mistaken for a
   * human manager. Only ChatAssistantService calls this, after it has
   * already decided — using only data it fetched itself, never the model's
   * own text — what the message body and `needsHuman` should be.
   *
   * Deliberately does not reuse the generic `insertMessage` below: that
   * helper's ON CONFLICT/client-message-id dedup logic exists for
   * client-retried sends, which does not apply here (the id is always a
   * fresh server-generated UUID), and its outbox-notify rule ("notify staff
   * on every non-staff message") is wrong for the assistant's own messages —
   * staff should only be paged when the assistant itself asks for a human.
   */
  async insertAssistantReply(
    threadId: string,
    body: string,
    replyToId: string | null,
    needsHuman: boolean,
  ): Promise<ChatMessageView | null> {
    const clientMessageId = randomUUID();
    const row = await this.database.transaction(async (client) => {
      const current = (await client.query<Pick<ThreadRow, "status" | "assigned_staff_id">>(
        "SELECT status,assigned_staff_id FROM app.chat_threads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [threadId],
      )).rows[0];
      if (!current || current.status === "closed" || current.assigned_staff_id) return null;
      // A retried or double-sent customer message reaches the assistant once
      // per HTTP request; the thread lock above makes this check the single
      // place where "one question, one automated answer" is decided.
      if (replyToId && await this.assistantAnswered(threadId, replyToId, client)) return null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.chat_messages
           (thread_id,sender_user_id,sender_kind,message_type,body,client_message_id,reply_to_id)
         VALUES ($1,NULL,'system','text',$2,$3,$4)
         RETURNING id`,
        [threadId, body, clientMessageId, replyToId],
      );
      const messageId = inserted.rows[0]!.id;
      await client.query(
        `UPDATE app.chat_threads SET
           last_message_at=clock_timestamp(),
           status=$2,
           version=version+1,
           updated_at=clock_timestamp()
         WHERE id=$1 AND status<>'closed'`,
        [threadId, needsHuman ? "waiting_staff" : "waiting_customer"],
      );
      if (needsHuman) {
        await client.query(
          `INSERT INTO app.outbox_events (topic,aggregate_type,aggregate_id,payload)
           VALUES ('chat.staff.notify','chat_thread',$1,$2::jsonb)`,
          [threadId, JSON.stringify({ messageId, senderKind: "system", threadId })],
        );
      }
      return (await client.query<MessageRow>(
        `${this.messageSelect()} WHERE message.id=$1`, [messageId],
      )).rows[0]!;
    });
    if (!row) return null;
    const view = this.messageView(row);
    await this.events.publish({ payload: { message: view, type: "message" }, threadId });
    return view;
  }

  private async insertMessage(
    client: PoolClient,
    threadId: string,
    sender: { kind: "customer" | "guest" | "staff"; userId: string | null },
    input: { body: string; clientMessageId: string; replyToId: string | null },
    messageType: "attachment" | "text",
  ): Promise<MessageRow> {
    if (input.replyToId) {
      const reply = await client.query(
        "SELECT 1 FROM app.chat_messages WHERE id=$1 AND thread_id=$2 AND deleted_at IS NULL",
        [input.replyToId, threadId],
      );
      if (reply.rowCount === 0) throw new BadRequestException("Ответ ссылается на чужое сообщение");
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO app.chat_messages
         (thread_id,sender_user_id,sender_kind,message_type,body,client_message_id,reply_to_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (thread_id,client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        threadId,
        sender.userId,
        sender.kind,
        messageType,
        input.body,
        input.clientMessageId,
        input.replyToId,
      ],
    );
    const row = (await client.query<MessageRow>(
      `${this.messageSelect()}
       WHERE message.thread_id=$1 AND message.client_message_id=$2`,
      [threadId, input.clientMessageId],
    )).rows[0];
    if (!row) throw new Error("Chat message insert did not return a row");
    if (
      row.body !== input.body
      || row.message_type !== messageType
      || row.reply_to_id !== input.replyToId
      || row.sender_kind !== sender.kind
      || row.sender_user_id !== sender.userId
    ) {
      throw new ConflictException("Этот client message id уже использован");
    }
    if (inserted.rowCount === 1) {
      await client.query(
        `UPDATE app.chat_threads SET
           last_message_at=clock_timestamp(),
           status=$2,
           version=version+1,
           updated_at=clock_timestamp()
         WHERE id=$1 AND status<>'closed'`,
        [threadId, sender.kind === "staff" ? "waiting_customer" : "waiting_staff"],
      );
      if (sender.kind !== "staff") {
        await client.query(
          `INSERT INTO app.outbox_events (topic,aggregate_type,aggregate_id,payload)
           VALUES ('chat.staff.notify','chat_thread',$1,$2::jsonb)`,
          [threadId, JSON.stringify({
            messageId: row.id,
            senderKind: sender.kind,
            threadId,
          })],
        );
      }
    }
    return row;
  }

  private async markDelivered(rows: MessageRow[], identity: ChatIdentity): Promise<void> {
    const ids = rows
      .filter((row) => identity.kind === "guest"
        ? row.sender_kind !== "guest"
        : row.sender_user_id !== identity.auth.userId)
      .map((row) => row.id);
    if (ids.length === 0) return;
    if (identity.kind === "guest") {
      await this.database.query(
        `INSERT INTO app.chat_guest_message_receipts (message_id,delivered_at)
         SELECT unnest($1::uuid[]),clock_timestamp()
         ON CONFLICT (message_id) DO UPDATE
         SET delivered_at=COALESCE(app.chat_guest_message_receipts.delivered_at,EXCLUDED.delivered_at)`,
        [ids],
      );
      return;
    }
    await this.database.query(
      `INSERT INTO app.chat_message_receipts (message_id,user_id,delivered_at)
       SELECT message_id,$2,clock_timestamp() FROM unnest($1::uuid[]) AS message_id
       ON CONFLICT (message_id,user_id) DO UPDATE
       SET delivered_at=COALESCE(app.chat_message_receipts.delivered_at,EXCLUDED.delivered_at)`,
      [ids, identity.auth.userId],
    );
  }

  /**
   * The honest snapshot of "is a human actually on this thread" sent to the
   * customer/guest client alongside history: never inferred, only what
   * `assigned_staff_id` already says. Only looks up the assignee's name
   * when someone is actually assigned, so the common unassigned case costs
   * nothing extra.
   */
  private async threadAssignmentView(thread: ThreadRow): Promise<{
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    managerWaitSince?: string | null;
    status: ThreadRow["status"];
  }> {
    if (!thread.assigned_staff_id) {
      return {
        assignedStaffId: null, assignedStaffName: null, status: thread.status,
        ...(thread.manager_wait_since !== undefined ? { managerWaitSince: thread.manager_wait_since?.toISOString() ?? null } : {}),
      };
    }
    const staff = (await this.database.query<{ display_name: string | null }>(
      "SELECT display_name FROM app.users WHERE id=$1",
      [thread.assigned_staff_id],
    )).rows[0];
    return {
      assignedStaffId: thread.assigned_staff_id,
      assignedStaffName: staff?.display_name ?? null,
      status: thread.status,
    };
  }

  private messageSelect(): string {
    return `SELECT message.*,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',attachment.id,
          'originalName',message.body,
          'mimeType',storage.mime_type,
          'byteSize',storage.byte_size
        ) ORDER BY attachment.created_at)
        FROM app.chat_attachments AS attachment
        JOIN app.storage_objects AS storage ON storage.id=attachment.storage_object_id
        WHERE attachment.message_id=message.id
          AND attachment.scan_status='clean' AND storage.status='available'
          AND storage.deleted_at IS NULL
      ),'[]'::jsonb) AS attachments
      FROM app.chat_messages AS message`;
  }

  private messageView(row: MessageRow): ChatMessageView {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    return {
      attachments: attachments.map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          byteSize: Number(entry.byteSize),
          id: String(entry.id),
          mimeType: String(entry.mimeType),
          originalName: String(entry.originalName),
        };
      }),
      body: row.body,
      clientMessageId: row.client_message_id,
      createdAt: row.created_at.toISOString(),
      id: row.id,
      messageType: row.message_type,
      replyToId: row.reply_to_id,
      senderKind: row.sender_kind,
      senderUserId: row.sender_user_id,
      sequence: row.sequence_number,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 256) : "unknown error";
  }

  private async receiveAttachment(file: MultipartFile, signal?: AbortSignal): Promise<Buffer> {
    if (this.activeAttachmentReceives >= MAX_CONCURRENT_ATTACHMENT_RECEIVES) {
      file.file?.destroy();
      throw new ServiceUnavailableException("Сейчас загружается слишком много файлов. Повторите позже");
    }
    this.activeAttachmentReceives += 1;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, content?: Buffer) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve(content!);
        };
        const stop = (error: Error) => {
          finish(error);
          file.file?.destroy();
        };
        const abort = () => stop(new BadRequestException("Загрузка файла прервана"));
        const timer = setTimeout(() => {
          stop(new RequestTimeoutException("Время загрузки файла истекло. Повторите попытку"));
        }, ATTACHMENT_RECEIVE_TIMEOUT_MS);
        timer.unref();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        void Promise.resolve().then(() => file.toBuffer()).then(
          (content) => finish(undefined, content),
          () => finish(new BadRequestException("Файл превышает 15 МБ или повреждён")),
        );
      });
    } finally {
      this.activeAttachmentReceives -= 1;
    }
  }

  private acquireAttachmentProcessingSlot(): () => void {
    if (this.activeAttachmentProcessing >= MAX_CONCURRENT_ATTACHMENT_PROCESSING) {
      throw new ServiceUnavailableException("Сейчас обрабатывается другой файл. Повторите загрузку через несколько секунд");
    }
    this.activeAttachmentProcessing += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeAttachmentProcessing = Math.max(0, this.activeAttachmentProcessing - 1);
    };
  }

  private async removeStoredObject(storageKey: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error) {
      this.logger.error(`Chat attachment cleanup failed: ${this.errorMessage(error)}`);
    }
  }

  private parseThread(body: unknown) {
    const parsed = ChatThreadCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_chat_thread", issues: parsed.error.issues });
    }
    return parsed.data;
  }

  private parseCursor(value: string | undefined): string {
    if (value === undefined) return "0";
    if (!/^(0|[1-9]\d{0,18})$/u.test(value)) throw new BadRequestException("Некорректный курсор");
    if (BigInt(value) > 9_223_372_036_854_775_807n) {
      throw new BadRequestException("Некорректный курсор");
    }
    return value;
  }

  private parseHistoryLimit(value: string | undefined): number {
    if (value === undefined) return 100;
    if (!/^[1-9]\d{0,2}$/u.test(value)) throw new BadRequestException("Некорректный лимит истории");
    const limit = Number(value);
    if (limit > 100) throw new BadRequestException("Максимальный лимит истории: 100");
    return limit;
  }

  private validGuestToken(value: string, expected: Buffer): boolean {
    return typeof value === "string"
      && value.length >= 32
      && value.length <= 256
      && this.crypto.opaqueHashMatches("guest-chat-access", value, expected);
  }

  private sender(identity: ChatIdentity) {
    if (identity.kind === "guest") return { kind: "guest" as const, userId: null };
    return {
      kind: identity.auth.role === "customer" ? "customer" as const : "staff" as const,
      userId: identity.auth.userId,
    };
  }

  private safeOriginalName(value: string): string {
    const name = path.basename(value).replace(/[\u0000-\u001F\u007F]/gu, "_").slice(0, 240).trim();
    return name || "attachment";
  }

  private parseUuid(value: string, message: string): void {
    if (!UUID.safeParse(value).success) throw new BadRequestException(message);
  }

  private threadView(row: ThreadRow) {
    return {
      assignedStaffId: row.assigned_staff_id,
      createdAt: row.created_at.toISOString(),
      id: row.id,
      lastMessageAt: row.last_message_at?.toISOString() ?? null,
      number: chatNumberLabel(row.public_number),
      orderId: row.order_id,
      publicNumber: row.public_number === null || row.public_number === undefined ? null : Number(row.public_number),
      status: row.status,
      subject: row.subject,
    };
  }
}
