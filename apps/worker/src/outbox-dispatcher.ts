import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { renderBrandedEmailHtml, renderBrandedEmailText, type BrandedEmail } from "./email-template.js";

import type { readWorkerConfig } from "./config.js";
import { NotificationProviders } from "./notification-providers.js";
import { ONE_C_EXCHANGE_LATE_TOPIC } from "./one-c-exchange-watch.js";
import { decryptSecret } from "./secret-crypto.js";

interface OutboxRow {
  aggregate_id: string;
  attempt_count: number;
  id: string;
  payload: unknown;
  topic: string;
}

const AuthPayloadSchema = z.object({
  encryptedToken: z.string().min(32),
  recipient: z.email(),
}).passthrough();

const ChatPayloadSchema = z.object({
  messageId: z.uuid(),
  // "system" is the AI chat assistant escalating to a human (see
  // ChatService.insertAssistantReply in apps/api) — every other
  // system-sender message never reaches this outbox topic (needsHuman=false
  // never inserts one), so a "system" event here always means the assistant
  // itself asked for help.
  senderKind: z.enum(["customer", "guest", "system"]),
  threadId: z.uuid(),
}).strict();

const ContactPayloadSchema = z.object({
  requestId: z.uuid(),
  source: z.enum(["contacts", "expert_help", "vin_request"]),
}).strict();

const LateExchangePayloadSchema = z.object({
  displayName: z.string().max(200),
  expectedSyncMinutes: z.number().int().positive(),
  lastOffersExchangeAt: z.iso.datetime(),
  sourceKey: z.enum(["one_c", "one_c_secondary"]),
}).strict();

const STAFF_ALERT_TOPICS = new Set(["chat.staff.notify", "contact.staff.notify", ONE_C_EXCHANGE_LATE_TOPIC]);

function hoursOrDays(minutes: number): string {
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours < 48 ? `${hours} ч` : `${Math.floor(hours / 24)} сут.`;
}

export function buildStaffAlert(
  topic: string,
  payload: unknown,
  publicBaseUrl: string,
  now: Date = new Date(),
): string {
  if (topic === ONE_C_EXCHANGE_LATE_TOPIC) {
    const late = LateExchangePayloadSchema.parse(payload);
    const name = late.displayName || (late.sourceKey === "one_c" ? "Основная база 1С" : "Дополнительная база 1С");
    const silent = hoursOrDays((now.getTime() - new Date(late.lastOffersExchangeAt).getTime()) / 60_000);
    const expected = late.expectedSyncMinutes === 1440 ? "раз в сутки" : `каждые ${late.expectedSyncMinutes} мин.`;
    const url = new URL("/admin/settings", publicBaseUrl);
    return `Обмен с 1С задерживается: «${name}» не присылала цены и остатки ${silent} (ожидается ${expected}). `
      + `Сайт показывает данные последнего обмена. Проверьте расписание обмена в 1С и «Отказы на входе». ${url}`;
  }
  if (topic === "chat.staff.notify") {
    const chat = ChatPayloadSchema.parse(payload);
    const url = new URL(`/admin/chats/${chat.threadId}`, publicBaseUrl);
    if (chat.senderKind === "system") {
      return `Автоматический ассистент АН-30 не смог закрыть вопрос и просит менеджера подключиться к чату. ${url}`;
    }
    const label = chat.senderKind === "guest" ? "Гость" : "Клиент";
    return `${label} написал в чат АН-30. ${url}`;
  }
  if (topic === "contact.staff.notify") {
    const contact = ContactPayloadSchema.parse(payload);
    const labels = {
      contacts: "Новое обращение",
      expert_help: "Запрос эксперту",
      vin_request: "Запрос подбора",
    } as const;
    const url = new URL("/admin/requests", publicBaseUrl);
    url.searchParams.set("request", contact.requestId);
    return `${labels[contact.source]} в АН-30. ${url}`;
  }
  throw new Error("unsupported_staff_alert_topic");
}

export function buildAuthEmailTemplate(
  topic: string,
  token: string,
  publicBaseUrl: string,
): { html: string; subject: string; text: string } {
  const routes: Record<string, { mode: string; subject: string; email: Omit<BrandedEmail, "action"> & { actionLabel: string } }> = {
    "auth.email.verify": {
      mode: "verify",
      subject: "Подтверждение email АН-30",
      email: {
        actionLabel: "Подтвердить email",
        lead: "Остался один шаг, чтобы открыть личный кабинет.",
        note: "Ссылка одноразовая. Если вы не регистрировались на сайте АН-30, просто удалите письмо — аккаунт не будет создан.",
        paragraphs: ["Здравствуйте! Вы зарегистрировались в магазине автозапчастей АН-30. Подтвердите адрес — и сможете следить за заказами, сохранить свой автомобиль и переписываться с магазином."],
        title: "Подтвердите email",
      },
    },
    "auth.password.reset": {
      mode: "reset",
      subject: "Восстановление пароля АН-30",
      email: {
        actionLabel: "Задать новый пароль",
        lead: "Вы запросили восстановление пароля.",
        note: "Ссылка одноразовая. Если вы не запрашивали восстановление, ничего не делайте — пароль останется прежним.",
        paragraphs: ["Здравствуйте! Чтобы задать новый пароль для личного кабинета АН-30, нажмите кнопку ниже."],
        title: "Новый пароль",
      },
    },
    "auth.staff.invitation": {
      mode: "staff-accept",
      subject: "Приглашение в команду АН-30",
      email: {
        actionLabel: "Принять приглашение",
        lead: "Вас пригласили в рабочее место магазина.",
        note: "Ссылка одноразовая и действует ограниченное время. Если вы не ждали приглашения, удалите письмо.",
        paragraphs: ["Здравствуйте! Администратор магазина АН-30 пригласил вас в рабочее место. Примите приглашение, задайте пароль и подключите вход по коду из приложения."],
        title: "Приглашение в команду",
      },
    },
  };
  const template = routes[topic];
  if (!template) throw new Error("unsupported_auth_topic");
  const url = new URL("/auth", publicBaseUrl);
  url.searchParams.set("mode", template.mode);
  url.hash = new URLSearchParams({ token }).toString();
  const email: BrandedEmail = {
    action: { label: template.email.actionLabel, url: url.toString() },
    lead: template.email.lead,
    note: template.email.note,
    paragraphs: template.email.paragraphs,
    title: template.email.title,
  };
  return {
    html: renderBrandedEmailHtml(email, publicBaseUrl),
    subject: template.subject,
    text: renderBrandedEmailText(email),
  };
}

export class OutboxDispatcher {
  private running = false;
  private readonly providers: NotificationProviders;

  constructor(
    private readonly database: Pool,
    private readonly config: ReturnType<typeof readWorkerConfig>,
    private readonly logger: Logger,
  ) {
    this.providers = new NotificationProviders(config.notifications);
  }

  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const event of await this.claim(10)) {
        try {
          await this.dispatch(event);
          await this.database.query(
            `UPDATE app.outbox_events SET status='delivered',delivered_at=clock_timestamp(),
                    locked_at=NULL,locked_by=NULL,last_error=NULL WHERE id=$1`,
            [event.id],
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
          const delaySeconds = Math.min(3_600, 30 * (2 ** Math.min(event.attempt_count, 7)));
          await this.database.query(
            `UPDATE app.outbox_events SET status='failed',available_at=clock_timestamp()+make_interval(secs=>$2),
                    locked_at=NULL,locked_by=NULL,last_error=$3 WHERE id=$1`,
            [event.id, delaySeconds, reason],
          );
          this.logger.warn({ eventId: event.id, topic: event.topic }, "Outbox delivery deferred");
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async claim(limit: number): Promise<OutboxRow[]> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await this.recoverStale(client);
      const rows = (await client.query<OutboxRow>(
        `SELECT id,topic,aggregate_id,payload,attempt_count
         FROM app.outbox_events
         WHERE status IN ('pending','failed') AND available_at<=clock_timestamp()
         ORDER BY available_at,created_at
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      )).rows;
      if (rows.length > 0) {
        await client.query(
          `UPDATE app.outbox_events SET status='processing',locked_at=clock_timestamp(),
                  locked_by=$2,attempt_count=attempt_count+1
           WHERE id=ANY($1::uuid[])`,
          [rows.map((row) => row.id), `worker:${process.pid}`],
        );
      }
      await client.query("COMMIT");
      return rows.map((row) => ({ ...row, attempt_count: row.attempt_count + 1 }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async dispatch(event: OutboxRow): Promise<void> {
    if (event.topic.startsWith("auth.")) {
      const payload = AuthPayloadSchema.parse(event.payload);
      const token = decryptSecret(
        payload.encryptedToken,
        this.config.dataEncryptionKey,
        `${event.topic}:${event.aggregate_id}`,
      );
      const template = this.authTemplate(event.topic, token);
      await this.providers.sendEmail(payload.recipient, template.subject, template.text, template.html);
      return;
    }
    if (STAFF_ALERT_TOPICS.has(event.topic)) {
      await this.providers.sendStaffAlert(
        buildStaffAlert(event.topic, event.payload, this.config.notifications.publicBaseUrl),
        event.id,
      );
      return;
    }
    throw new Error("unsupported_outbox_topic");
  }

  private authTemplate(topic: string, token: string): { html: string; subject: string; text: string } {
    return buildAuthEmailTemplate(topic, token, this.config.notifications.publicBaseUrl);
  }

  private async recoverStale(client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE app.outbox_events SET status='failed',available_at=clock_timestamp(),
              locked_at=NULL,locked_by=NULL,last_error='stale_worker_lock'
       WHERE status='processing' AND locked_at<clock_timestamp()-interval '5 minutes'`,
    );
  }
}
