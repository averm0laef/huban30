import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { readWorkerConfig } from "./config.js";
import { NotificationProviders } from "./notification-providers.js";
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
  senderKind: z.enum(["customer", "guest"]),
  threadId: z.uuid(),
}).strict();

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
      await this.providers.sendEmail(payload.recipient, template.subject, template.text);
      return;
    }
    if (event.topic === "chat.staff.notify") {
      const payload = ChatPayloadSchema.parse(event.payload);
      const label = payload.senderKind === "guest" ? "Гость" : "Клиент";
      await this.providers.sendStaffAlert(
        `${label} написал в чат АН-30. ${this.config.notifications.publicBaseUrl}/admin/chats/${payload.threadId}`,
        event.id,
      );
      return;
    }
    throw new Error("unsupported_outbox_topic");
  }

  private authTemplate(topic: string, token: string): { subject: string; text: string } {
    const routes: Record<string, { route: string; subject: string }> = {
      "auth.email.verify": { route: "/auth/verify", subject: "Подтверждение email АН-30" },
      "auth.password.reset": { route: "/auth/reset", subject: "Восстановление пароля АН-30" },
      "auth.staff.invitation": { route: "/staff/invitation", subject: "Приглашение в команду АН-30" },
    };
    const template = routes[topic];
    if (!template) throw new Error("unsupported_auth_topic");
    const url = new URL(template.route, this.config.notifications.publicBaseUrl);
    url.searchParams.set("token", token);
    return {
      subject: template.subject,
      text: `Откройте одноразовую ссылку: ${url.toString()}\n\nЕсли вы не запрашивали это действие, проигнорируйте письмо.`,
    };
  }

  private async recoverStale(client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE app.outbox_events SET status='failed',available_at=clock_timestamp(),
              locked_at=NULL,locked_by=NULL,last_error='stale_worker_lock'
       WHERE status='processing' AND locked_at<clock_timestamp()-interval '5 minutes'`,
    );
  }
}
