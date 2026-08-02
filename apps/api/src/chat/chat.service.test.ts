import { describe, expect, it, vi } from "vitest";

import type { StorageProvider } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { CryptoService } from "../security/crypto.service.js";
import type { ChatEventBus } from "./chat-event-bus.service.js";
import { ChatService } from "./chat.service.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";

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
