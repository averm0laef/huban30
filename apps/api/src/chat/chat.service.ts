import { createHash } from "node:crypto";
import path from "node:path";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { MultipartFile } from "@fastify/multipart";
import { fileTypeFromBuffer } from "file-type";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  ChatMessageCreateSchema,
  ChatThreadCreateSchema,
  ROLE_PERMISSIONS,
  type Permission,
} from "@an30/contracts";

import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import type { ChatIdentity, ChatMessageView } from "./chat.types.js";

const UUID = z.uuid();
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENTS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

interface ThreadRow {
  assigned_staff_id: string | null;
  created_at: Date;
  customer_user_id: string | null;
  guest_token_hash: Buffer | null;
  id: string;
  last_message_at: Date | null;
  order_id: string | null;
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
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly events: ChatEventBus,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
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
    const result = await this.database.transaction(async (client) => {
      const thread = (await client.query<ThreadRow>(
        `INSERT INTO app.chat_threads (customer_user_id,order_id,subject)
         VALUES ($1,$2,$3) RETURNING *`,
        [auth.userId, input.orderId, input.subject],
      )).rows[0]!;
      await client.query(
        "INSERT INTO app.chat_participants (thread_id,user_id) VALUES ($1,$2)",
        [thread.id, auth.userId],
      );
      return thread;
    });
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
         JOIN app.stock_reservations AS reservation ON reservation.id=checkout_order.reservation_id
         WHERE checkout_order.id=$1 AND checkout_order.user_id IS NULL AND reservation.guest_token_hash=$2`,
        [input.orderId, this.crypto.opaqueHash("guest-order-access", guestOrderToken)],
      );
      if (order.rowCount === 0) throw new NotFoundException("Заказ не найден");
    }
    const guestToken = this.crypto.randomToken();
    const thread = (await this.database.query<ThreadRow>(
      `INSERT INTO app.chat_threads (guest_token_hash,order_id,subject)
       VALUES ($1,$2,$3) RETURNING *`,
      [this.crypto.opaqueHash("guest-chat-access", guestToken), input.orderId, input.subject],
    )).rows[0]!;
    return { ...this.threadView(thread), guestToken };
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

  async history(threadId: string, after: string | undefined, identity: ChatIdentity) {
    await this.authorize(threadId, identity);
    const cursor = this.parseCursor(after);
    const result = await this.database.query<MessageRow>(
      `${this.messageSelect()}
       WHERE message.thread_id=$1 AND message.sequence_number>$2 AND message.deleted_at IS NULL
       ORDER BY message.sequence_number LIMIT 100`,
      [threadId, cursor],
    );
    await this.markDelivered(result.rows, identity);
    return {
      items: result.rows.map((row) => this.messageView(row)),
      nextSequence: result.rows.at(-1)?.sequence_number ?? cursor,
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
  ) {
    const parsedClientId = z.uuid().safeParse(clientMessageId);
    if (!parsedClientId.success) throw new BadRequestException("Требуется корректный x-client-message-id");
    if (!file) throw new BadRequestException("Файл не передан");
    const thread = await this.authorize(threadId, identity);
    if (thread.status === "closed") throw new ConflictException("Чат закрыт");

    let content: Buffer;
    try {
      content = await file.toBuffer();
    } catch {
      throw new BadRequestException("Файл превышает 5 МБ или повреждён");
    }
    if (content.length === 0 || content.length > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException("Допустимый размер файла: от 1 байта до 5 МБ");
    }
    const detected = await fileTypeFromBuffer(content);
    const extension = detected ? ALLOWED_ATTACHMENTS.get(detected.mime) : undefined;
    if (!detected || !extension || file.mimetype !== detected.mime) {
      throw new BadRequestException("Разрешены только JPEG, PNG и WebP с корректной сигнатурой");
    }
    const originalName = this.safeOriginalName(file.filename);
    const sha256 = createHash("sha256").update(content).digest();
    const stored = await this.storage.store(content, extension);
    let removeNewObject = false;
    try {
      const result = await this.database.transaction(async (client) => {
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
      if (removeNewObject) await this.storage.remove(stored.storageKey);
      const view = this.messageView(result);
      await this.events.publish({ payload: { message: view, type: "message" }, threadId });
      return view;
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
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
         AND storage.status='available' AND storage.deleted_at IS NULL`,
      [attachmentId],
    )).rows[0];
    if (!attachment) throw new NotFoundException("Вложение не найдено");
    await this.authorize(attachment.thread_id, identity);
    const content = await this.storage.read(attachment.storage_key);
    if (content.length !== Number(attachment.byte_size)) throw new NotFoundException("Вложение повреждено");
    return { content, mimeType: attachment.mime_type, originalName: attachment.original_name };
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

  private parseThread(body: unknown) {
    const parsed = ChatThreadCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_chat_thread", issues: parsed.error.issues });
    }
    return parsed.data;
  }

  private parseCursor(value: string | undefined): string {
    if (!value) return "0";
    if (!/^(0|[1-9]\d{0,18})$/u.test(value)) throw new BadRequestException("Некорректный курсор");
    return value;
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
      orderId: row.order_id,
      status: row.status,
      subject: row.subject,
    };
  }
}
