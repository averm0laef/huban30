import { describe, expect, it } from "vitest";

import {
  LEGAL_DOCUMENT_DATE,
  OWNER_DETAILS_PLACEHOLDER,
  storeContentPages,
} from "./legacy-pages";

function pageText(key: keyof typeof storeContentPages): string {
  const page = storeContentPages[key];
  if (!page) throw new Error(`Missing content page: ${key}`);
  return [page.intro, ...page.sections.map(({ body }) => body)].join(" ");
}

describe("public legal content", () => {
  it("keeps missing seller details as an explicit production blocker", () => {
    expect(OWNER_DETAILS_PLACEHOLDER).toContain("БЛОКИРУЕТ PRODUCTION");
    expect(pageText("terms")).toContain(OWNER_DETAILS_PLACEHOLDER);
    expect(pageText("privacy")).toContain(OWNER_DETAILS_PLACEHOLDER);
    expect(pageText("terms")).toContain(LEGAL_DOCUMENT_DATE);
    expect(pageText("privacy")).toContain(LEGAL_DOCUMENT_DATE);
  });

  it("does not turn an ordinary VIN-selected part into a custom-made item", () => {
    const returns = pageText("returns");
    expect(returns).toContain("не становится товаром с индивидуально-определёнными свойствами");
    expect(returns).toContain("в течение 7 дней");
    expect(returns).toContain("срок составляет 3 месяца");
    expect(returns).not.toContain("подобран индивидуально под ваш автомобиль");
  });

  it("does not publish infrastructure and payment claims that are not configured", () => {
    const privacy = pageText("privacy");
    const terms = pageText("terms");
    expect(privacy).not.toContain("хранятся на серверах, расположенных на территории Российской Федерации");
    expect(privacy).not.toContain("неизменяемом журнале");
    expect(privacy).not.toContain("выбранную тему");
    expect(terms).not.toContain("Приём платежей осуществляется через платёжного провайдера");
    expect(terms).toContain("должны быть подтверждены владельцем до production");
  });

  it("publishes a separate, purpose-specific document for every public form", () => {
    const purposes = [
      "checkout-personal-data-consent",
      "contact-personal-data-consent",
      "supplier-waitlist-personal-data-consent",
    ] as const;

    for (const purpose of purposes) {
      const text = pageText(purpose);
      expect(text).toContain("Версия");
      expect(text).toContain("не включает рекламу");
      expect(text).toContain("до 30 дней");
    }
  });
});
