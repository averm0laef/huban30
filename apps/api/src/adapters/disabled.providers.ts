import { Injectable } from "@nestjs/common";

import type {
  AiProvider,
  NotificationMessage,
  NotificationProvider,
  NotificationResult,
  SocialAuthProvider,
  SocialIdentity,
} from "./provider-contracts.js";

@Injectable()
export class DisabledNotificationProvider implements NotificationProvider {
  async send(_message: NotificationMessage): Promise<NotificationResult> {
    return { accepted: false, provider: "disabled", reason: "disabled" };
  }
}

@Injectable()
export class DisabledSocialAuthProvider implements SocialAuthProvider {
  async verify(_provider: "telegram" | "vk", _payload: unknown): Promise<SocialIdentity | null> {
    return null;
  }
}

@Injectable()
export class DisabledAiProvider implements AiProvider {
  readonly enabled = false;

  async expandSearchQuery(_query: string): Promise<readonly string[]> {
    return [];
  }
}

