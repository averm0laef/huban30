import { Readable } from "node:stream";

import type { MultipartFile } from "@fastify/multipart";
import {
  BadRequestException,
  ConflictException,
  Logger,
  RequestTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { CryptoService } from "../security/crypto.service.js";
import {
  MalwareDetectedError,
  MalwareScannerUnavailableError,
  type MalwareScannerService,
} from "../security/malware-scanner.service.js";
import {
  InvalidMediaError,
  type MediaValidationService,
} from "../security/media-validation.service.js";
import type { ChatEventBus } from "./chat-event-bus.service.js";
import { ChatService } from "./chat.service.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const STORAGE_ID = "77777777-7777-4777-8777-777777777777";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("ChatService read cursor", () => {
  it("marks every inbound message through the selected sequence as read", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        assigned_staff_id: null,
        created_at: new Date("2026-08-02T00:00:00Z"),
        customer_user_id: null,
        guest_token_hash: Buffer.from("guest"),
        id: THREAD_ID,
        last_message_at: null,
        order_id: null,
        status: "open",
        subject: null,
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ sequence_number: "7" }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new ChatService(
      { query } as unknown as DatabaseService,
      {} as CryptoService,
      { publish } as unknown as ChatEventBus,
      {} as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );
    const auth: AuthContext = {
      csrfTokenHash: Buffer.alloc(32),
      email: "manager@example.test",
      mfaSetupRequired: false,
      mfaVerified: true,
      role: "manager",
      sessionId: "44444444-4444-4444-8444-444444444444",
      userId: STAFF_ID,
    };

    await service.markRead(THREAD_ID, MESSAGE_ID, { auth, kind: "authenticated" });

    expect(query.mock.calls[2]?.[0]).toContain("candidate.sequence_number<=$2::bigint");
    expect(query.mock.calls[2]?.[0]).toContain("candidate.sender_user_id IS DISTINCT FROM $3::uuid");
    expect(query.mock.calls[2]?.[1]).toEqual([THREAD_ID, "7", STAFF_ID]);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD_ID }));
  });
});

describe("ChatService history thread snapshot", () => {
  const auth: AuthContext = {
    csrfTokenHash: Buffer.alloc(32),
    email: "manager@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "manager",
    sessionId: "44444444-4444-4444-8444-444444444444",
    userId: STAFF_ID,
  };

  it("reports no assignment (and skips the name lookup) when nobody has taken the thread", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        assigned_staff_id: null,
        created_at: new Date("2026-08-02T00:00:00Z"),
        customer_user_id: null,
        guest_token_hash: null,
        id: THREAD_ID,
        last_message_at: null,
        order_id: null,
        status: "waiting_staff",
        subject: null,
      }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const service = new ChatService(
      { query } as unknown as DatabaseService,
      {} as CryptoService,
      { publish: vi.fn() } as unknown as ChatEventBus,
      {} as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );

    const result = await service.history(THREAD_ID, undefined, { auth, kind: "authenticated" });

    expect(result.thread).toEqual({ assignedStaffId: null, assignedStaffName: null, status: "waiting_staff" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("never invents an assignee name — it only reports what assigned_staff_id and the users table actually say", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        assigned_staff_id: STAFF_ID,
        created_at: new Date("2026-08-02T00:00:00Z"),
        customer_user_id: null,
        guest_token_hash: null,
        id: THREAD_ID,
        last_message_at: null,
        order_id: null,
        status: "waiting_staff",
        subject: null,
      }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ display_name: "Ирина Соколова" }] });
    const service = new ChatService(
      { query } as unknown as DatabaseService,
      {} as CryptoService,
      { publish: vi.fn() } as unknown as ChatEventBus,
      {} as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );

    const result = await service.history(THREAD_ID, undefined, { auth, kind: "authenticated" });

    expect(result.thread).toEqual({
      assignedStaffId: STAFF_ID,
      assignedStaffName: "Ирина Соколова",
      status: "waiting_staff",
    });
    expect(query.mock.calls[2]?.[0]).toContain("FROM app.users");
    expect(query.mock.calls[2]?.[1]).toEqual([STAFF_ID]);
  });
});

describe("ChatService attachment security and durability", () => {
  const auth: AuthContext = {
    csrfTokenHash: Buffer.alloc(32),
    email: "manager@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "manager",
    sessionId: "44444444-4444-4444-8444-444444444444",
    userId: STAFF_ID,
  };
  const thread = {
    assigned_staff_id: null,
    created_at: new Date("2026-08-02T00:00:00Z"),
    customer_user_id: null,
    guest_token_hash: null,
    id: THREAD_ID,
    last_message_at: null,
    order_id: null,
    status: "open",
    subject: null,
  } as const;
  const baseMessage = {
    attachments: [],
    body: "part.png",
    client_message_id: CLIENT_MESSAGE_ID,
    created_at: new Date("2026-08-15T00:00:00Z"),
    id: MESSAGE_ID,
    message_type: "attachment",
    reply_to_id: null,
    sender_kind: "staff",
    sender_user_id: STAFF_ID,
    sequence_number: "8",
    thread_id: THREAD_ID,
  } as const;

  function multipart(content = PNG): MultipartFile {
    return {
      filename: "part.png",
      mimetype: "image/png",
      toBuffer: vi.fn().mockResolvedValue(content),
    } as unknown as MultipartFile;
  }

  function setup(options: {
    mediaError?: Error;
    publishError?: Error;
    scanError?: Error;
    threadStatusAfterScan?: "closed" | "open";
  } = {}) {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [thread] });
    const clientQuery = vi.fn(async (text: string) => {
      if (text.includes("SELECT status FROM app.chat_threads")) {
        return {
          rowCount: 1,
          rows: [{ status: options.threadStatusAfterScan ?? "open" }],
        };
      }
      if (text.includes("INSERT INTO app.storage_objects")) {
        return {
          rowCount: 1,
          rows: [{ id: STORAGE_ID, status: "available", storage_key: "chat/2026-08/new.png" }],
        };
      }
      if (text.includes("INSERT INTO app.chat_messages")) {
        return { rowCount: 1, rows: [{ id: MESSAGE_ID }] };
      }
      if (text.includes("message.client_message_id=$2")) {
        return { rowCount: 1, rows: [baseMessage] };
      }
      if (text.includes("UPDATE app.chat_threads")) return { rowCount: 1, rows: [] };
      if (text.includes("SELECT storage.sha256")) return { rowCount: 0, rows: [] };
      if (text.includes("INSERT INTO app.chat_attachments")) return { rowCount: 1, rows: [] };
      if (text.includes("WHERE message.id=$1")) {
        return {
          rowCount: 1,
          rows: [{
            ...baseMessage,
            attachments: [{
              byteSize: PNG.length,
              id: ATTACHMENT_ID,
              mimeType: "image/png",
              originalName: "part.png",
            }],
          }],
        };
      }
      throw new Error(`Unexpected test SQL: ${text}`);
    });
    const transaction = vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
      work({ query: clientQuery })
    ));
    const remove = vi.fn().mockResolvedValue(undefined);
    const store = vi.fn().mockResolvedValue({ byteSize: PNG.length, storageKey: "chat/2026-08/new.png" });
    const storage = {
      name: "local",
      open: vi.fn(),
      read: vi.fn(),
      remove,
      store,
    } as unknown as StorageProvider;
    const assertClean = options.scanError
      ? vi.fn().mockRejectedValue(options.scanError)
      : vi.fn().mockResolvedValue(undefined);
    const assertValid = options.mediaError
      ? vi.fn().mockRejectedValue(options.mediaError)
      : vi.fn().mockResolvedValue(undefined);
    const publish = options.publishError
      ? vi.fn().mockRejectedValue(options.publishError)
      : vi.fn().mockResolvedValue(undefined);
    const service = new ChatService(
      { query, transaction } as unknown as DatabaseService,
      {} as CryptoService,
      { publish } as unknown as ChatEventBus,
      storage,
      { assertClean } as unknown as MalwareScannerService,
      { assertValid } as unknown as MediaValidationService,
    );
    return {
      assertClean,
      assertValid,
      clientQuery,
      publish,
      query,
      remove,
      service,
      store,
      transaction,
    };
  }

  it("keeps the committed object available when realtime publish fails", async () => {
    const logger = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const setupResult = setup({ publishError: new Error("redis publish failed") });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).resolves.toMatchObject({ id: MESSAGE_ID, messageType: "attachment" });

    expect(setupResult.assertClean).toHaveBeenCalledWith(PNG);
    expect(setupResult.assertValid).toHaveBeenCalledWith(PNG, "image/png");
    expect(setupResult.assertClean.mock.invocationCallOrder[0])
      .toBeLessThan(setupResult.store.mock.invocationCallOrder[0]!);
    expect(setupResult.assertValid.mock.invocationCallOrder[0])
      .toBeLessThan(setupResult.store.mock.invocationCallOrder[0]!);
    expect(setupResult.remove).not.toHaveBeenCalled();
    expect(setupResult.publish).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("publish failed"));
    logger.mockRestore();
  });

  it("rejects infected media before validation, storage, or database mutation", async () => {
    const setupResult = setup({ scanError: new MalwareDetectedError("Eicar-Signature") });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(setupResult.assertValid).not.toHaveBeenCalled();
    expect(setupResult.store).not.toHaveBeenCalled();
    expect(setupResult.transaction).not.toHaveBeenCalled();
  });

  it("fails upload closed with 503 when clamd is unavailable", async () => {
    const setupResult = setup({
      scanError: new MalwareScannerUnavailableError("connection refused"),
    });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(setupResult.store).not.toHaveBeenCalled();
    expect(setupResult.transaction).not.toHaveBeenCalled();
  });

  it("returns a useful two-minute validation message before storage", async () => {
    const setupResult = setup({ mediaError: new InvalidMediaError("duration") });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).rejects.toMatchObject({
      response: { message: "Видео должно быть не длиннее 2 минут", statusCode: 400 },
    });

    expect(setupResult.store).not.toHaveBeenCalled();
  });

  it("returns a retriable 503 when bounded media validation times out", async () => {
    const setupResult = setup({ mediaError: new InvalidMediaError("timeout") });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).rejects.toMatchObject({
      response: { statusCode: 503 },
    });

    expect(setupResult.store).not.toHaveBeenCalled();
  });

  it("admits only one attachment scan/decode at a time across the service", async () => {
    const setupResult = setup();
    let releaseScan!: () => void;
    setupResult.assertClean.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseScan = resolve;
    }));
    const first = setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    );
    await vi.waitFor(() => expect(setupResult.assertClean).toHaveBeenCalledOnce());

    const competingFile = multipart();
    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      "88888888-8888-4888-8888-888888888888",
      competingFile,
      { auth, kind: "authenticated" },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(competingFile.toBuffer).toHaveBeenCalledOnce();
    expect(setupResult.assertClean).toHaveBeenCalledOnce();

    releaseScan();
    await expect(first).resolves.toMatchObject({ id: MESSAGE_ID });
  });

  it("lets another upload finish while one sender has not completed its body", async () => {
    const setupResult = setup();
    const controller = new AbortController();
    const stream = new Readable({ read() {} });
    const pendingFile = { ...multipart(), file: stream, toBuffer: () => new Promise<Buffer>(() => undefined) };
    const pending = setupResult.service.uploadAttachment(
      THREAD_ID, CLIENT_MESSAGE_ID, pendingFile as MultipartFile,
      { auth, kind: "authenticated" }, controller.signal,
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(BadRequestException);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(setupResult.service.uploadAttachment(
      THREAD_ID, CLIENT_MESSAGE_ID, multipart(), { auth, kind: "authenticated" },
    )).resolves.toMatchObject({ id: MESSAGE_ID });
    controller.abort();
    await rejected;
    expect(stream.destroyed).toBe(true);
  });

  it("destroys a stalled upload at its receive deadline and releases admission", async () => {
    vi.useFakeTimers();
    const setupResult = setup();
    const stream = new Readable({ read() {} });
    const pendingFile = { ...multipart(), file: stream, toBuffer: () => new Promise<Buffer>(() => undefined) };
    try {
      const pending = setupResult.service.uploadAttachment(
        THREAD_ID, CLIENT_MESSAGE_ID, pendingFile as MultipartFile,
        { auth, kind: "authenticated" },
      );
      const rejected = expect(pending).rejects.toBeInstanceOf(RequestTimeoutException);
      await vi.advanceTimersByTimeAsync(30_001);
      await rejected;
      expect(stream.destroyed).toBe(true);
      expect(setupResult.assertClean).not.toHaveBeenCalled();
      await expect(setupResult.service.uploadAttachment(
        THREAD_ID, CLIENT_MESSAGE_ID, multipart(), { auth, kind: "authenticated" },
      )).resolves.toMatchObject({ id: MESSAGE_ID });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds simultaneous receivers and releases them when clients abort", async () => {
    const setupResult = setup();
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const uploads = controllers.map((controller) => setupResult.service.uploadAttachment(
      THREAD_ID, CLIENT_MESSAGE_ID,
      { ...multipart(), file: new Readable({ read() {} }), toBuffer: () => new Promise<Buffer>(() => undefined) } as MultipartFile,
      { auth, kind: "authenticated" }, controller.signal,
    ).catch((error: unknown) => error));
    await new Promise((resolve) => setImmediate(resolve));
    try {
      await expect(setupResult.service.uploadAttachment(
        THREAD_ID, CLIENT_MESSAGE_ID, multipart(), { auth, kind: "authenticated" },
      )).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(setupResult.assertClean).not.toHaveBeenCalled();
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.all(uploads);
    }
    await expect(setupResult.service.uploadAttachment(
      THREAD_ID, CLIENT_MESSAGE_ID, multipart(), { auth, kind: "authenticated" },
    )).resolves.toMatchObject({ id: MESSAGE_ID });
  });

  it("rechecks and locks thread state after scanning, cleaning up if staff closed it", async () => {
    const setupResult = setup({ threadStatusAfterScan: "closed" });

    await expect(setupResult.service.uploadAttachment(
      THREAD_ID,
      CLIENT_MESSAGE_ID,
      multipart(),
      { auth, kind: "authenticated" },
    )).rejects.toBeInstanceOf(ConflictException);

    expect(setupResult.remove).toHaveBeenCalledWith("chat/2026-08/new.png");
    expect(setupResult.publish).not.toHaveBeenCalled();
  });

  it("streams clean attachments and excludes soft-deleted messages in the direct lookup", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        byte_size: "4",
        mime_type: "image/png",
        original_name: "part.png",
        scan_status: "clean",
        storage_key: "chat/2026-08/object.png",
        thread_id: THREAD_ID,
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [thread] });
    const stream = Readable.from(Buffer.from("safe"));
    const open = vi.fn().mockResolvedValue({ byteSize: 4, content: stream });
    const read = vi.fn();
    const service = new ChatService(
      { query } as unknown as DatabaseService,
      {} as CryptoService,
      { publish: vi.fn() } as unknown as ChatEventBus,
      { name: "local", open, read } as unknown as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );

    await expect(service.readAttachment(
      ATTACHMENT_ID,
      { auth, kind: "authenticated" },
    )).resolves.toMatchObject({ byteSize: 4, content: stream, mimeType: "image/png" });

    expect(query.mock.calls[0]?.[0]).toContain("message.deleted_at IS NULL");
    expect(query.mock.calls[0]?.[0]).toContain("storage.deleted_at IS NULL");
    expect(open).toHaveBeenCalledWith("chat/2026-08/object.png");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("ChatService bounded history pagination", () => {
  const auth: AuthContext = {
    csrfTokenHash: Buffer.alloc(32),
    email: "manager@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "manager",
    sessionId: "44444444-4444-4444-8444-444444444444",
    userId: STAFF_ID,
  };
  const thread = {
    assigned_staff_id: null,
    created_at: new Date("2026-08-02T00:00:00Z"),
    customer_user_id: null,
    guest_token_hash: null,
    id: THREAD_ID,
    last_message_at: null,
    order_id: null,
    status: "open",
    subject: null,
  };
  const row = (sequence: string) => ({
    attachments: [],
    body: `message-${sequence}`,
    client_message_id: null,
    created_at: new Date("2026-08-15T00:00:00Z"),
    id: `${sequence.padStart(8, "0")}-2222-4222-8222-222222222222`,
    message_type: "text",
    reply_to_id: null,
    sender_kind: "staff",
    sender_user_id: STAFF_ID,
    sequence_number: sequence,
    thread_id: THREAD_ID,
  });

  function serviceWithRows(rows: ReturnType<typeof row>[]) {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [thread] })
      .mockResolvedValueOnce({ rowCount: rows.length, rows });
    const service = new ChatService(
      { query } as unknown as DatabaseService,
      {} as CryptoService,
      { publish: vi.fn() } as unknown as ChatEventBus,
      {} as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );
    return { query, service };
  }

  it("returns the latest bounded window in ascending order with an exclusive older cursor", async () => {
    const setup = serviceWithRows([row("6"), row("5"), row("4")]);

    const result = await setup.service.history(
      THREAD_ID,
      undefined,
      { auth, kind: "authenticated" },
      { before: "latest", limit: "2" },
    );

    expect(result.items.map((item) => item.sequence)).toEqual(["5", "6"]);
    expect(result.nextSequence).toBe("6");
    expect(result.olderCursor).toBe("5");
    expect(setup.query.mock.calls[1]?.[0]).toContain("ORDER BY message.sequence_number DESC LIMIT $3");
    expect(setup.query.mock.calls[1]?.[1]).toEqual([THREAD_ID, null, 3]);
  });

  it("uses before as an exclusive stable sequence cursor", async () => {
    const setup = serviceWithRows([row("4"), row("3")]);

    const result = await setup.service.history(
      THREAD_ID,
      undefined,
      { auth, kind: "authenticated" },
      { before: "5", limit: "2" },
    );

    expect(result.items.map((item) => item.sequence)).toEqual(["3", "4"]);
    expect(result.olderCursor).toBeNull();
    expect(setup.query.mock.calls[1]?.[1]).toEqual([THREAD_ID, "5", 3]);
  });

  it("rejects ambiguous cursor direction and oversized pages", async () => {
    const both = serviceWithRows([]);
    await expect(both.service.history(
      THREAD_ID,
      "0",
      { auth, kind: "authenticated" },
      { before: "latest", limit: "50" },
    )).rejects.toBeInstanceOf(BadRequestException);

    const oversized = serviceWithRows([]);
    await expect(oversized.service.history(
      THREAD_ID,
      undefined,
      { auth, kind: "authenticated" },
      { before: "latest", limit: "101" },
    )).rejects.toBeInstanceOf(BadRequestException);

    const cursorOverflow = serviceWithRows([]);
    await expect(cursorOverflow.service.history(
      THREAD_ID,
      undefined,
      { auth, kind: "authenticated" },
      { before: "9999999999999999999", limit: "50" },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ChatService assistant reply for a repeated message", () => {
  it("stores no second automated answer to the same customer message", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ assigned_staff_id: null, status: "waiting_staff" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] });
    const publish = vi.fn();
    const service = new ChatService(
      {
        transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
          work({ query: clientQuery })
        )),
      } as unknown as DatabaseService,
      {} as CryptoService,
      { publish } as unknown as ChatEventBus,
      {} as StorageProvider,
      {} as MalwareScannerService,
      {} as MediaValidationService,
    );

    await expect(service.insertAssistantReply(THREAD_ID, "Ответ", MESSAGE_ID, false)).resolves.toBeNull();

    // The thread row is locked before the check, so two copies of one message cannot both pass it.
    expect(clientQuery.mock.calls[0]?.[0]).toContain("FOR UPDATE");
    expect(clientQuery.mock.calls[1]?.[1]).toEqual([THREAD_ID, MESSAGE_ID]);
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
  });
});
