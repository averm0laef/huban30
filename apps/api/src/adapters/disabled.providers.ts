import { Injectable } from "@nestjs/common";

import type { AssistantChatResult } from "@an30/contracts";

import {
  AN30_COMPANY_FACTS,
  type AiChatRequest,
  type AiProvider,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationResult,
  type SocialAuthProvider,
  type SocialIdentity,
  type SupplierProvider,
  type SupplierSearchResult,
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

// AI_ENABLED=false must leave the shop and chat fully working (ADR-004): no
// network call, no guessing, just an honest "unavailable" answer that still
// points the customer at a human.
const ASSISTANT_UNAVAILABLE: AssistantChatResult = {
  message: `Автоматический помощник сейчас недоступен. Задайте вопрос здесь в чате — менеджер ответит `
    + `${AN30_COMPANY_FACTS.hours}, либо позвоните ${AN30_COMPANY_FACTS.phone}.`,
  needsHuman: true,
};

@Injectable()
export class DisabledAiProvider implements AiProvider {
  readonly enabled = false;

  async answerCustomerQuestion(_request: AiChatRequest): Promise<AssistantChatResult> {
    return ASSISTANT_UNAVAILABLE;
  }

  async expandSearchQuery(_query: string): Promise<readonly string[]> {
    return [];
  }
}

@Injectable()
export class DisabledSupplierProvider implements SupplierProvider {
  readonly enabled = false;

  async search(_query: string): Promise<SupplierSearchResult> {
    return { message: "Поиск у поставщика отключён", parts: [], success: false };
  }
}

