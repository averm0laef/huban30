import { createHash } from "node:crypto";

import nodemailer, { type Transporter } from "nodemailer";

import type { readWorkerConfig } from "./config.js";

type NotificationConfig = ReturnType<typeof readWorkerConfig>["notifications"];

type SmtpConfig = NotificationConfig["smtp"];

/**
 * How the worker connects to the mail server. Always encrypted (STARTTLS required on 587, TLS from the first byte
 * on 465), never reading a file or a URL into a letter, and giving up within seconds on a server that does not
 * answer: nodemailer's own defaults wait two minutes for a connection and ten for a silent socket, and one stuck
 * letter would hold the password-recovery letters queued behind it.
 */
export function smtpTransportOptions(smtp: SmtpConfig) {
  return {
    auth: smtp.user ? { pass: smtp.password, user: smtp.user } : undefined,
    connectionTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    greetingTimeout: 10_000,
    host: smtp.host,
    port: smtp.port,
    requireTLS: !smtp.secure,
    secure: smtp.secure,
    socketTimeout: 30_000,
  };
}

/** The sender a customer sees: the shop by name, at the configured address. */
export function smtpSender(smtp: SmtpConfig): { address: string; name: string } | undefined {
  return smtp.from ? { address: smtp.from, name: smtp.fromName } : undefined;
}

export class NotificationProviders {
  private readonly mailer: Transporter | undefined;

  constructor(private readonly config: NotificationConfig) {
    this.mailer = config.smtp.enabled ? nodemailer.createTransport(smtpTransportOptions(config.smtp)) : undefined;
  }

  get emailEnabled(): boolean {
    return Boolean(this.mailer);
  }

  async sendEmail(recipient: string, subject: string, text: string, html?: string): Promise<void> {
    const from = smtpSender(this.config.smtp);
    if (!this.mailer || !from) throw new Error("smtp_disabled");
    await this.mailer.sendMail({ from, subject, text, to: recipient, ...(html ? { html } : {}) });
  }

  async sendStaffAlert(text: string, idempotencyKey: string): Promise<number> {
    const deliveries: Array<Promise<void>> = [];
    if (this.config.telegram.enabled) deliveries.push(this.sendTelegram(text));
    if (this.config.vk.enabled) deliveries.push(this.sendVk(text, idempotencyKey));
    await Promise.all(deliveries);
    return deliveries.length;
  }

  private async sendTelegram(text: string): Promise<void> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.config.telegram.botToken}/sendMessage`,
      {
        body: JSON.stringify({ chat_id: this.config.telegram.chatId, text }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`telegram_http_${response.status}`);
    const result = await response.json() as { ok?: boolean };
    if (result.ok !== true) throw new Error("telegram_rejected");
  }

  private async sendVk(text: string, idempotencyKey: string): Promise<void> {
    const randomId = createHash("sha256").update(idempotencyKey).digest().readUInt32BE(0) & 0x7fff_ffff;
    const body = new URLSearchParams({
      access_token: this.config.vk.accessToken ?? "",
      message: text,
      peer_id: String(this.config.vk.peerId),
      random_id: String(randomId || 1),
      v: "5.199",
    });
    const response = await fetch("https://api.vk.com/method/messages.send", {
      body,
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`vk_http_${response.status}`);
    const result = await response.json() as { error?: unknown; response?: unknown };
    if (result.error || result.response === undefined) throw new Error("vk_rejected");
  }
}
