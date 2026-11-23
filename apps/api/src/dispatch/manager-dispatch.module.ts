import { Body, Controller, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Req, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthContext } from "../auth/auth-context.js";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { ChatEventBus } from "../chat/chat-event-bus.service.js";
import { ChatModule } from "../chat/chat.module.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";

const availabilityInput = z.object({ available: z.boolean() }).strict();

/**
 * How long a customer's unanswered chat stays with a manager who is no longer
 * confirming availability (closed the tab, logged out, lost the connection)
 * before it goes back to the queue for whoever is at work.
 */
export const UNATTENDED_CHAT_RELEASE_SECONDS = 5 * 60;

@Injectable()
export class ManagerDispatchService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ManagerDispatchService.name);
  private readonly environment: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly events: ChatEventBus,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    config: ConfigService,
  ) {
    this.environment = config.getOrThrow<string>("DEPLOYMENT_ENVIRONMENT");
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.dispatch(), 3_000);
    this.timer.unref();
  }

  onModuleDestroy() { clearInterval(this.timer); }

  async setAvailability(input: unknown, actor: AuthContext) {
    const parsed = availabilityInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException("Некорректный статус менеджера");
    await this.limits.consume("manager-availability", actor.userId, 60, 60);
    if (parsed.data.available) {
      await this.db.query(
        `INSERT INTO app.manager_availability(user_id,session_id,expires_at)
         VALUES($1,$2,clock_timestamp()+interval '55 seconds')
         ON CONFLICT(user_id) DO UPDATE SET session_id=EXCLUDED.session_id,expires_at=EXCLUDED.expires_at`,
        [actor.userId, actor.sessionId],
      );
      void this.dispatch();
    } else {
      await this.db.query("DELETE FROM app.manager_availability WHERE user_id=$1 AND session_id=$2", [actor.userId, actor.sessionId]);
    }
    return parsed.data;
  }

  /** One pass: returns unattended chats to the queue, then hands the queue out. */
  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      for (const released of await this.releaseUnattended()) {
        await this.events.publish({
          threadId: released.id,
          payload: {
            type: "thread", status: "waiting_staff", assignedStaffId: null, assignedStaffName: null,
            managerWaitSince: released.managerWaitSince,
          },
        });
      }
      for (let count = 0; count < 8; count++) {
        const assignment = await this.assignNext();
        if (!assignment) break;
        if (assignment.kind === "web") {
          await this.events.publish({
            threadId: assignment.id,
            payload: { type: "thread", status: "waiting_staff", assignedStaffId: assignment.userId, assignedStaffName: assignment.name, managerWaitSince: null },
          });
        }
      }
    } catch {
      this.logger.warn("Распределение обращений временно недоступно, очередь сохранена");
    } finally {
      this.running = false;
    }
  }

  /**
   * A chat is assigned once and nothing took it back: when its manager left,
   * the customer's next message waited for that manager alone and nobody else
   * could answer. Chats waiting for staff with no change for the release
   * window return to the queue here, and the pass below hands them out again.
   * A manager whose tab is still confirming availability keeps every chat.
   */
  private releaseUnattended() {
    return this.db.transaction(async (tx) => {
      const lock = await tx.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended('an30-manager-dispatch',0)) AS acquired");
      if (!lock.rows[0]?.acquired) return [];
      // The assignment is read before the update clears it, for the audit log.
      const released = (await tx.query<{ id: string; manager_wait_since: Date | null; staff_id: string }>(
        `WITH unattended AS (
           SELECT t.id,t.assigned_staff_id AS staff_id,t.updated_at AS waiting_since FROM app.chat_threads t
           WHERE t.status='waiting_staff' AND t.assigned_staff_id IS NOT NULL AND t.deleted_at IS NULL
             AND t.updated_at<clock_timestamp()-make_interval(secs => $1)
             AND NOT EXISTS (
               SELECT 1 FROM app.manager_availability a
               WHERE a.user_id=t.assigned_staff_id AND a.expires_at>clock_timestamp()
             )
           ORDER BY t.updated_at,t.id LIMIT 50 FOR UPDATE OF t SKIP LOCKED
         )
         UPDATE app.chat_threads t
         SET assigned_staff_id=NULL,manager_wait_since=unattended.waiting_since,version=t.version+1
         FROM unattended WHERE t.id=unattended.id
         RETURNING t.id,t.manager_wait_since,unattended.staff_id`,
        [UNATTENDED_CHAT_RELEASE_SECONDS],
      )).rows;
      for (const thread of released) {
        await this.audit.record({
          action: "chat.manager_released", entityType: "chat_thread", entityId: thread.id,
          metadata: { previousStaffId: thread.staff_id, reason: "manager_unavailable" },
        }, tx);
      }
      return released.map((thread) => ({
        id: thread.id,
        managerWaitSince: thread.manager_wait_since?.toISOString() ?? null,
      }));
    });
  }

  private assignNext() {
    return this.db.transaction(async (tx) => {
      const lock = await tx.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended('an30-manager-dispatch',0)) AS acquired");
      if (!lock.rows[0]?.acquired) return null;
      const staff = (await tx.query<{ user_id: string; name: string; role: AuthContext["role"] }>(
        `SELECT a.user_id, COALESCE(NULLIF(trim(u.display_name),''),'Менеджер АН30') AS name, staff.role
         FROM app.manager_availability a
         JOIN app.staff_members staff ON staff.user_id=a.user_id AND staff.status='active'
         JOIN app.users u ON u.id=a.user_id AND u.status='active' AND u.deleted_at IS NULL
         JOIN app.auth_sessions s ON s.id=a.session_id AND s.user_id=a.user_id
         CROSS JOIN LATERAL (
           SELECT (SELECT count(*) FROM app.chat_threads t WHERE t.assigned_staff_id=a.user_id AND t.status NOT IN ('closed','waiting_customer') AND t.deleted_at IS NULL)
                + (SELECT count(*) FROM app.hub_conversations h WHERE h.assigned_to=a.user_id AND h.state='assigned') AS active
         ) workload
         WHERE a.expires_at>clock_timestamp() AND s.revoked_at IS NULL AND s.mfa_verified_at IS NOT NULL
           AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
           AND (u.session_invalid_before IS NULL OR s.created_at>=u.session_invalid_before)
           AND workload.active<5 AND staff.role IN ('manager','director','admin')
         ORDER BY workload.active,a.user_id LIMIT 1 FOR SHARE OF a,staff,s`,
      )).rows[0];
      if (!staff) return null;
      const waiting = (await tx.query<{ id: string; kind: "web" | "hub" }>(
        `SELECT id,kind FROM (
           SELECT t.id,'web' AS kind,t.manager_wait_since
           FROM app.chat_threads t WHERE t.status='waiting_staff' AND t.assigned_staff_id IS NULL AND t.deleted_at IS NULL
           UNION ALL
           SELECT v.id,'hub',v.manager_wait_since FROM app.hub_conversations v
             JOIN app.hub_connections c ON c.id=v.connection_id
           WHERE v.state='waiting' AND v.assigned_to IS NULL AND c.environment=$1 AND c.inbox_enabled
         ) waiting ORDER BY manager_wait_since,id LIMIT 1`,
        [this.environment],
      )).rows[0];
      if (!waiting) return null;
      if (waiting.kind === "web") {
        const updated = await tx.query(
          `UPDATE app.chat_threads SET assigned_staff_id=$2,version=version+1
           WHERE id=$1 AND status='waiting_staff' AND assigned_staff_id IS NULL AND deleted_at IS NULL`,
          [waiting.id, staff.user_id],
        );
        if (!updated.rowCount) return null;
      } else {
        const updated = (await tx.query<{ connection_id: string; reply_allowed: boolean }>(
          `UPDATE app.hub_conversations v SET state='assigned',assigned_to=$2,version=v.version+1
           FROM app.hub_connections c WHERE v.id=$1 AND c.id=v.connection_id AND c.inbox_enabled
             AND v.state='waiting' AND v.assigned_to IS NULL
           RETURNING c.id AS connection_id,(c.platform<>'whatsapp' OR v.last_inbound_at>clock_timestamp()-interval '24 hours') AS reply_allowed`,
          [waiting.id, staff.user_id],
        )).rows[0];
        if (!updated) return null;
        if (updated.reply_allowed) {
          const message = staff.name === "Менеджер АН30"
            ? "К диалогу подключился менеджер АН30."
            : `Менеджер ${staff.name} подключился к диалогу.`;
          const row = (await tx.query<{ id: string }>(
            `INSERT INTO app.hub_messages(conversation_id,connection_id,direction,sender_kind,sender_user_id,body)
             VALUES($1,$2,'outgoing','operator',$3,$4) RETURNING id`,
            [waiting.id, updated.connection_id, staff.user_id, message],
          )).rows[0]!;
          await tx.query("INSERT INTO app.hub_jobs(connection_id,message_id) VALUES($1,$2)", [updated.connection_id, row.id]);
        }
      }
      await this.audit.record({
        action: "chat.manager_connected", actorUserId: staff.user_id, actorRole: staff.role,
        entityType: waiting.kind === "web" ? "chat_thread" : "hub_conversation", entityId: waiting.id,
      }, tx);
      return { ...waiting, userId: staff.user_id, name: staff.name };
    });
  }
}

@Controller("staff/availability")
class ManagerAvailabilityController {
  constructor(private readonly service: ManagerDispatchService) {}
  @RequirePermissions("chat:manage:any", "inbox:manage")
  @Post()
  availability(@Body() input: unknown, @Req() request: FastifyRequest) {
    return this.service.setAvailability(input, request.authContext!);
  }
}

@Module({ imports: [ChatModule], controllers: [ManagerAvailabilityController], providers: [ManagerDispatchService] })
export class ManagerDispatchModule {}
