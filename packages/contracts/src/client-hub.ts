import { z } from "zod";

export const HUB_PLATFORMS = ["telegram", "vk", "max", "whatsapp"] as const;
export const HubPlatformSchema = z.enum(HUB_PLATFORMS);
export type HubPlatform = z.infer<typeof HubPlatformSchema>;
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u);
export const HubSecretsSchema = z.object({
  token: z.string().min(10).max(4_096).optional(),
  publishingToken: z.string().min(10).max(4_096).optional(),
  webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/u).optional(),
  confirmationCode: z.string().min(1).max(256).optional(),
  verifyToken: z.string().min(24).max(256).optional(),
  appSecret: z.string().min(16).max(256).optional(),
}).strict();
export type HubSecrets = z.infer<typeof HubSecretsSchema>;
export const HubConnectionInputSchema = z.object({
  id: z.uuid(), version: z.number().int().positive().optional(),
  platform: HubPlatformSchema, name: text(120),
  isTest: z.boolean().default(true),
  publishEnabled: z.boolean().default(false), inboxEnabled: z.boolean().default(false),
  publishTarget: z.string().trim().max(500).default(""),
  inboxTarget: z.string().trim().max(200).default(""),
  publicUrl: z.union([z.literal(""), z.url({ protocol: /^https$/u })]).default(""),
  secrets: HubSecretsSchema.default({}),
}).strict();
export const HubPostInputSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive().optional(),
  kind: z.enum(["news", "arrival"]), title: text(160), body: text(3_700),
  imageUrl: z.url({ protocol: /^https$/u }).max(2_000).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.imageUrl && `${value.title}\n\n${value.body}`.length > 1_024) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Пост с фото должен содержать не больше 1024 символов вместе с заголовком" });
  }
});
export type HubPostInput = z.infer<typeof HubPostInputSchema>;
export const HubPublishSchema = z.object({
  revision: z.number().int().positive(),
  connectionIds: z.array(z.uuid()).min(1).max(20).optional(),
}).strict();
export const HubConversationActionSchema = z.object({ version: z.number().int().positive() }).strict();
export const HubReplySchema = z.object({ clientKey: z.uuid(), body: text(3_700) }).strict();
export const HubResolveSchema = z.object({
  action: z.enum(["bind", "not_published", "manual_done", "mark_sent"]),
  confirmed: z.literal(true), externalId: z.string().trim().min(1).max(200).optional(),
}).strict();
export const HubFaqSchema = z.object({
  version: z.number().int().positive(),
  faq: z.array(z.object({ title: text(120), keywords: z.array(text(60)).min(1).max(15), answer: text(1_000), approved: z.boolean() }).strict()).max(20),
}).strict();
export const HubListQuerySchema = z.object({
  state: z.enum(["all", "bot", "waiting", "assigned", "closed"]).default("all"),
  connectionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export interface HubConnectionView {
  id: string; platform: HubPlatform; name: string; environment: string; isTest: boolean;
  publishEnabled: boolean; inboxEnabled: boolean; publishTarget: string; inboxTarget: string;
  publicUrl: string; version: number; hasToken: boolean; hasPublishingToken: boolean;
  hasWebhookSecret: boolean; hasAppSecret: boolean; webhookUrl: string;
  lastCheckedAt: string | null; diagnostic: { checks: Array<{ name: string; ok: boolean; detail: string; at?: string }> } | null;
}
export interface HubJobView {
  id: string; connectionId: string; platform: HubPlatform; connectionName: string;
  state: "queued" | "sending" | "succeeded" | "failed" | "unknown" | "manual";
  revision: number | null; appliedRevision: number; externalId: string | null;
  /** What is published under externalId: Telegram cannot switch a post between the two. */
  contentKind?: "text" | "image" | null;
  attemptCount: number; lastError: string | null; createdAt: string;
}
export interface HubPostView extends Omit<HubPostInput, "id" | "revision"> {
  id: string; revision: number; updatedAt: string; jobs: HubJobView[];
}
export interface HubConversationView {
  id: string; connectionId: string; platform: HubPlatform; connectionName: string;
  customerName: string; peerId: string; state: "bot" | "waiting" | "assigned" | "closed";
  assignedTo: string | null; assignedName: string | null; version: number;
  managerWaitSince?: string | null;
  lastMessageAt: string; lastMessagePreview: string; unreadCount: number;
}
export interface HubMessageView {
  id: string; direction: "incoming" | "outgoing"; senderKind: "customer" | "operator" | "bot";
  body: string; createdAt: string; media: Array<{ type: string; name?: string }>;
  state: HubJobView["state"] | null; jobId: string | null;
  /** Delivery error code of an outgoing message, for the staff view. */
  lastError?: string | null;
}
