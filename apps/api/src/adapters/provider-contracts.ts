export interface NotificationMessage {
  body: string;
  channel: "email" | "telegram" | "vk";
  recipient: string;
  subject?: string;
}

export interface NotificationResult {
  accepted: boolean;
  provider: string;
  reason?: "disabled" | "unsupported";
}

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<NotificationResult>;
}

export interface SocialIdentity {
  externalId: string;
  provider: "telegram" | "vk";
  verified: boolean;
}

export interface SocialAuthProvider {
  verify(provider: "telegram" | "vk", payload: unknown): Promise<SocialIdentity | null>;
}

export interface AiProvider {
  readonly enabled: boolean;
  expandSearchQuery(query: string): Promise<readonly string[]>;
}

export interface StoredObject {
  byteSize: number;
  storageKey: string;
}

export interface StorageProvider {
  readonly name: string;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
  store(content: Buffer, extension: string): Promise<StoredObject>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");
export const SOCIAL_AUTH_PROVIDER = Symbol("SOCIAL_AUTH_PROVIDER");
export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

