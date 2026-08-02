import type { AuthContext } from "../auth/auth-context.js";

export type ChatIdentity =
  | { auth: AuthContext; kind: "authenticated" }
  | { guestToken: string; kind: "guest" };

export interface ChatMessageView {
  attachments: Array<{
    byteSize: number;
    id: string;
    mimeType: string;
    originalName: string;
  }>;
  body: string | null;
  clientMessageId: string | null;
  createdAt: string;
  id: string;
  messageType: "attachment" | "system" | "text";
  replyToId: string | null;
  senderKind: "customer" | "guest" | "staff" | "system";
  senderUserId: string | null;
  sequence: string;
}

