import { describe, expect, it } from "vitest";

import { renderBrandedEmailHtml, renderBrandedEmailText } from "./email-template.js";

const email = {
  action: { label: "Подтвердить email", url: "https://an30.ru/auth?mode=verify#token=abc" },
  lead: "Остался один шаг.",
  note: "Ссылка одноразовая.",
  paragraphs: ["Здравствуйте! <script>alert(1)</script>"],
  title: "Подтвердите email",
};

describe("branded e-mail", () => {
  it("renders the logo from the storefront, the button and the fallback link", () => {
    const html = renderBrandedEmailHtml(email, "https://an30.ru/");
    expect(html).toContain('src="https://an30.ru/email/logo-white@2x.png"');
    expect(html).not.toContain("car@2x.png");
    expect(html.match(/https:\/\/an30\.ru\/auth\?mode=verify#token=abc/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("tel:+79244742605");
  });

  it("escapes text so a value can never inject markup", () => {
    const html = renderBrandedEmailHtml(email, "https://an30.ru");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has a plain-text twin with the link", () => {
    expect(renderBrandedEmailText(email)).toContain("Подтвердить email: https://an30.ru/auth?mode=verify#token=abc");
  });
});

// Seen on a rendered letter: the line «Письмо отправлено автоматически…» was 11.5 px in a grey of weak contrast.
describe("the small print of a letter", () => {
  it("is never smaller than 12 px", () => {
    const html = renderBrandedEmailHtml({ action: { label: "Открыть", url: "https://an30.ru/auth" }, lead: "Вступление", note: "Примечание", paragraphs: ["Текст"], title: "Заголовок" }, "https://an30.ru");
    const sizes = [...html.matchAll(/font-size:\s*([0-9.]+)px/gu)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});
