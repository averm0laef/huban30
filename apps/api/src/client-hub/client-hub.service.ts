import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  HubConnectionInputSchema, HubPostInputSchema, HubPublishSchema, HubListQuerySchema,
  HubReplySchema, HubResolveSchema, HubConversationActionSchema, HubFaqSchema,
  type HubSecrets, type HubPlatform,
} from "@an30/contracts";
import { MessengerClient, messengerFromEnvironment, normalizeIncoming, identifier, type DiagnosticCheck, parseWebhookJson, verifyWebhook, secretEqual, safeImageUrl, DeliveryError, type Channel } from "@an30/messaging";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { AuditService } from "../security/audit.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { botDecision, type FaqRule } from "./bot-policy.js";
import { HUB_WEBHOOK_MAX_BYTES } from "./webhook-protection.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Проверьте заполнение формы и длину текста");
  return result.data;
}
function uuid(value: unknown) { return parse(z.uuid(), value); }
type Connection = { id: string; platform: HubPlatform; environment: string; is_test: boolean; publish_enabled: boolean; inbox_enabled: boolean;
  publish_target: string; inbox_target: string; encrypted_credentials: Buffer; version: number } & Record<string, unknown>;
const connectionColumns = `id,platform,name,environment,is_test AS "isTest",publish_enabled AS "publishEnabled",inbox_enabled AS "inboxEnabled",
  publish_target AS "publishTarget",inbox_target AS "inboxTarget",public_url AS "publicUrl",version,last_checked_at AS "lastCheckedAt",diagnostic`;
const jobColumns = `j.id,j.connection_id AS "connectionId",c.platform,c.name AS "connectionName",j.state,j.revision,
  COALESCE(p.applied_revision,0) AS "appliedRevision",p.external_id AS "externalId",j.attempt_count AS "attemptCount",j.last_error AS "lastError",j.created_at AS "createdAt"`;
const conversationColumns = `v.id,v.connection_id AS "connectionId",c.platform,c.name AS "connectionName",v.customer_name AS "customerName",v.peer_id AS "peerId",
  v.state,v.assigned_to AS "assignedTo",COALESCE(u.display_name,u.email::text) AS "assignedName",v.version,v.last_message_at AS "lastMessageAt",
  v.last_message_preview AS "lastMessagePreview",v.unread_count AS "unreadCount",v.manager_wait_since AS "managerWaitSince"`;


@Injectable()
export class ClientHubService {
  private readonly transport: MessengerClient;
  private readonly environment: string;
  /** Provider APIs are served by a local emulator (never in production). */
  private readonly emulated: boolean;
  constructor(private readonly db: DatabaseService, private readonly crypto: CryptoService, private readonly audit: AuditService,
    private readonly limits: RateLimitService, private readonly config: ConfigService) {
    this.environment = config.getOrThrow<string>("DEPLOYMENT_ENVIRONMENT");
    const messenger = messengerFromEnvironment(process.env, this.environment);
    this.transport = messenger.client; this.emulated = messenger.emulated;
  }
  /** Real sends are allowed in production, or anywhere against the local emulator. */
  private get liveAllowed() { return this.environment === "production" || this.emulated; }
  private channel(row: Connection): Channel {
    return { platform: row.platform, publishTarget: row.publish_target, inboxTarget: row.inbox_target,
      secrets: JSON.parse(this.crypto.decrypt(row.encrypted_credentials, `hub:${row.id}`)) as HubSecrets };
  }
  private async connection(id: string) {
    const row = (await this.db.query<Connection>("SELECT * FROM app.hub_connections WHERE id=$1 AND environment=$2", [uuid(id), this.environment])).rows[0];
    if (!row) throw new NotFoundException("Подключение не найдено");
    return row;
  }
  private webhookUrl(id: string) { return `${this.config.getOrThrow<string>("APP_ORIGIN").replace(/\/$/u, "")}/api/v1/client-hub/webhooks/${id}`; }
  async connections() {
    const rows = (await this.db.query(`SELECT ${connectionColumns},encrypted_credentials FROM app.hub_connections WHERE environment=$1 ORDER BY created_at,id`, [this.environment])).rows;
    return { items: rows.map((row) => {
      const secrets = JSON.parse(this.crypto.decrypt(row.encrypted_credentials as Buffer, `hub:${row.id}`)) as HubSecrets;
      const { encrypted_credentials: _secret, ...view } = row;
      return { ...view, hasToken: !!secrets.token, hasPublishingToken: !!secrets.publishingToken, hasWebhookSecret: !!secrets.webhookSecret,
        hasAppSecret: !!secrets.appSecret, webhookUrl: this.webhookUrl(row.id as string) };
    }) };
  }
  async saveConnection(input: unknown, actor: AuthContext) {
    const data = parse(HubConnectionInputSchema, input);
    if (!data.isTest && !this.liveAllowed) throw new BadRequestException("Реальные отправки доступны только в рабочем окружении. Здесь используйте тестовый режим.");
    if (/^-?\d+$/u.test(data.publishTarget)) data.publishTarget = BigInt(data.publishTarget).toString();
    if (/^\d+$/u.test(data.inboxTarget)) data.inboxTarget = BigInt(data.inboxTarget).toString();
    if (data.platform === "telegram" && data.publishTarget.startsWith("@")) data.publishTarget = data.publishTarget.toLowerCase();
    if (data.platform === "telegram" && /^https:\/\/t\.me\/[A-Za-z0-9_]{4,}$/u.test(data.publishTarget)) data.publishTarget = `@${data.publishTarget.slice(13).toLowerCase()}`;
    // The owner should not have to find numeric IDs: the token tells us the
    // MAX bot and the VK community. A typed value is still respected.
    if (!data.isTest && (data.platform === "max" || data.platform === "vk") && (!data.inboxTarget || (data.platform === "vk" && data.publishEnabled && !data.publishTarget))) {
      const old = (await this.db.query<Connection>("SELECT * FROM app.hub_connections WHERE id=$1 AND environment=$2", [data.id,this.environment])).rows[0];
      const token = data.secrets.token ?? (old && this.channel(old).secrets.token);
      if (token) {
        let account = "";
        try { account = await this.transport.accountId({ platform: data.platform, publishTarget: data.publishTarget, inboxTarget: data.inboxTarget, secrets: { token } }); } catch { /* reported below */ }
        if (!/^\d+$/u.test(account)) throw new BadRequestException(data.platform === "max" ? "MAX не принял токен бота. Скопируйте его заново в MAX для партнёров." : "ВКонтакте не принял ключ сообщества. Создайте ключ в разделе «Работа с API» заново.");
        if (!data.inboxTarget) data.inboxTarget = account;
        if (data.platform === "vk" && data.publishEnabled && !data.publishTarget) data.publishTarget = `-${account}`;
      }
    }
    if (!data.isTest && data.platform === "telegram" && data.publishEnabled && data.publishTarget) {
      const old = (await this.db.query<Connection>("SELECT * FROM app.hub_connections WHERE id=$1 AND environment=$2", [data.id,this.environment])).rows[0];
      const token = data.secrets.token ?? (old && this.channel(old).secrets.token);
      if (!token) throw new BadRequestException("Добавьте токен подключения");
      try {
        data.publishTarget = await this.transport.canonicalPublishTarget({
          platform: "telegram", publishTarget: data.publishTarget, inboxTarget: data.inboxTarget, secrets: { token },
        });
      } catch {
        throw new BadRequestException("Telegram не подтвердил ID канала. Проверьте токен, адрес и доступ бота.");
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hub-connection:${data.id}`]);
      const existing = (await tx.query<Connection>("SELECT * FROM app.hub_connections WHERE id=$1 FOR UPDATE", [data.id])).rows[0];
      if (existing && (existing.environment !== this.environment || existing.version !== data.version)) throw new ConflictException("Подключение изменено. Откройте его заново.");
      if (existing && existing.platform !== data.platform) throw new ConflictException("Для другой площадки создайте новое подключение");
      if (existing && (existing.platform !== data.platform || existing.publish_target !== data.publishTarget || existing.inbox_target !== data.inboxTarget || existing.is_test !== data.isTest)) {
        const used = (await tx.query("SELECT 1 FROM app.hub_jobs WHERE connection_id=$1 UNION ALL SELECT 1 FROM app.hub_conversations WHERE connection_id=$1 LIMIT 1", [data.id])).rowCount;
        if (used) throw new ConflictException("У подключения уже есть история. Создайте новое подключение для другого аккаунта или режима.");
      }
      const secrets = { ...(existing ? this.channel(existing).secrets : {}), ...data.secrets };
      if (data.publishEnabled && !data.publishTarget) throw new BadRequestException("Укажите канал публикации");
      if (data.publishEnabled && data.platform === "vk" && !/^-\d+$/u.test(data.publishTarget)) throw new BadRequestException("Для стены ВКонтакте нужен отрицательный ID сообщества");
      if (data.inboxEnabled && (data.platform === "vk" || data.platform === "whatsapp") && !data.inboxTarget) throw new BadRequestException(data.platform === "vk" ? "Укажите ID сообщества ВКонтакте или добавьте ключ сообщества — ID определится по нему" : "Укажите Phone Number ID для входящих");
      if (!data.isTest) {
        if (data.platform === "vk" && data.inboxEnabled && !/^[1-9]\d*$/u.test(data.inboxTarget)) throw new BadRequestException("Для Callback API нужен числовой ID сообщества без минуса");
        if (data.platform === "vk" && data.inboxEnabled && (secrets.webhookSecret?.length ?? 0) > 50) throw new BadRequestException("Секрет Callback API ВКонтакте должен содержать не больше 50 символов");
        if ((data.inboxEnabled || (data.publishEnabled && data.platform !== "whatsapp")) && !secrets.token) throw new BadRequestException("Добавьте токен подключения");
        if (data.publishEnabled && data.platform === "vk" && !secrets.publishingToken) throw new BadRequestException("Для публикаций ВКонтакте нужен отдельный токен с правом wall");
        if (data.inboxEnabled && data.platform !== "whatsapp" && !secrets.webhookSecret) throw new BadRequestException("Добавьте секрет проверки входящих событий");
        if (data.inboxEnabled && data.platform === "whatsapp" && (!secrets.appSecret || !secrets.verifyToken)) throw new BadRequestException("Для WhatsApp нужны App Secret и Verify Token");
      }
      const encrypted = this.crypto.encrypt(JSON.stringify(secrets), `hub:${data.id}`);
      if (existing) await tx.query(`UPDATE app.hub_connections SET name=$2,is_test=$3,publish_enabled=$4,inbox_enabled=$5,publish_target=$6,inbox_target=$7,
        public_url=$8,encrypted_credentials=$9,version=version+1,updated_at=clock_timestamp(),diagnostic=NULL,last_checked_at=NULL WHERE id=$1`,
      [data.id,data.name,data.isTest,data.publishEnabled,data.inboxEnabled,data.publishTarget,data.inboxTarget,data.publicUrl,encrypted]);
      else await tx.query(`INSERT INTO app.hub_connections(id,platform,name,environment,is_test,publish_enabled,inbox_enabled,publish_target,inbox_target,public_url,encrypted_credentials,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [data.id,data.platform,data.name,this.environment,data.isTest,data.publishEnabled,data.inboxEnabled,data.publishTarget,data.inboxTarget,data.publicUrl,encrypted,actor.userId]);
      await this.audit.record({ action: "hub.connection.saved", actorUserId: actor.userId, actorRole: actor.role, entityType: "hub_connection", entityId: data.id }, tx);
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new ConflictException("Эта площадка уже подключена. Откройте существующее подключение.");
      throw error;
    });
    return this.connections();
  }
  async diagnose(id: string, actor: AuthContext) {
    await this.limits.consume("hub-diagnostics", actor.userId, 10, 60);
    const row = await this.connection(id);
    const diagnostic = row.is_test ? { checks: [{ name: "Тестовый режим", ok: true, detail: "Отправки имитируются на сайте. Чтобы проверить настоящий аккаунт, выключите тестовый режим в настройках подключения." }] as DiagnosticCheck[] }
      : await this.transport.diagnose(this.channel(row), { webhookUrl: this.webhookUrl(id), publish: row.publish_enabled, inbox: row.inbox_enabled });
    if (!row.is_test && row.inbox_enabled) {
      // VK cannot report its Callback API state to a community key, so the
      // proof is an event that actually reached this site.
      const last = (await this.db.query<{ at: Date | null }>("SELECT max(received_at) AS at FROM app.hub_events WHERE connection_id=$1", [id])).rows[0]?.at;
      if (last) diagnostic.checks.push({ name: "Последнее входящее событие", ok: true, detail: "Получено", at: last.toISOString() });
      if (row.platform === "max") {
        const chats = (await this.db.query<{ chat: string }>("SELECT substr(event_id,10) AS chat FROM app.hub_events WHERE connection_id=$1 AND event_id LIKE 'max\\_chat:%' ORDER BY received_at DESC LIMIT 5", [id])).rows.map(r => r.chat);
        if (chats.length) diagnostic.checks.push({ name: "Бот добавлен в каналы", ok: true, detail: `ID: ${chats.join(", ")}` });
        else if (!row.publish_target) diagnostic.checks.push({ name: "Канал публикаций", ok: false, detail: "max_channel_unknown" });
      }
      if (!last && row.platform === "vk") diagnostic.checks.push({ name: "Сообщения клиентов", ok: false, detail: "vk_no_events_yet" });
    }
    await this.db.query("UPDATE app.hub_connections SET diagnostic=$2::jsonb,last_checked_at=clock_timestamp() WHERE id=$1 AND version=$3", [id,JSON.stringify(diagnostic),row.version]);
    return diagnostic;
  }
  async activateWebhook(id: string, input: unknown, actor: AuthContext) {
    const data = parse(z.object({ confirmed: z.literal(true), replaceExisting: z.boolean().default(false), version: z.number().int().positive() }).strict(), input);
    await this.limits.consume("hub-activation", actor.userId, 5, 60);
    const row = await this.connection(id);
    if (row.version !== data.version) throw new ConflictException("Подключение изменилось");
    if (!row.inbox_enabled || row.is_test) throw new BadRequestException("Сначала включите приём обращений для рабочего подключения");
    try { await this.transport.configureWebhook(this.channel(row), this.webhookUrl(id), data.replaceExisting); }
    catch (e) { throw new BadRequestException(e instanceof DeliveryError ? e.code : "Не удалось настроить приём событий"); }
    await this.audit.record({ action: "hub.webhook.activated", actorUserId: actor.userId, actorRole: actor.role, entityType: "hub_connection", entityId: id });
    return { ok: true };
  }
  private async enqueue(tx: PoolClient, postId: string, revision: number, ids?: string[]) {
    const connections = (await tx.query<Connection>(`SELECT * FROM app.hub_connections WHERE environment=$1 AND publish_enabled
      AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY id FOR SHARE`, [this.environment,ids ?? null])).rows;
    if (ids && connections.length !== ids.length) throw new BadRequestException("Часть выбранных площадок отключена");
    for (const connection of connections) {
      const publication = (await tx.query<{ id: string }>(`INSERT INTO app.hub_publications(post_id,connection_id) VALUES($1,$2)
        ON CONFLICT(post_id,connection_id) DO UPDATE SET post_id=EXCLUDED.post_id RETURNING id`, [postId,connection.id])).rows[0]!;
      await tx.query(`INSERT INTO app.hub_jobs(connection_id,publication_id,revision,state) VALUES($1,$2,$3,$4) ON CONFLICT(publication_id,revision) DO NOTHING`,
        [connection.id,publication.id,revision,connection.platform === "whatsapp" ? "manual" : "queued"]);
    }
    return connections.length;
  }
  async savePost(input: unknown, actor: AuthContext) {
    const data = parse(HubPostInputSchema, input);
    if (data.imageUrl && !safeImageUrl(data.imageUrl)) throw new BadRequestException("Нужна публичная ссылка HTTPS на изображение");
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hub-post:${data.id}`]);
      const old = (await tx.query("SELECT * FROM app.hub_posts WHERE id=$1 FOR UPDATE", [data.id])).rows[0];
      // A replay of the same client-generated ID/body must not add a revision.
      if (old && old.title === data.title && old.body === data.body && old.image_url === data.imageUrl && old.kind === data.kind) return { id: data.id, revision: old.revision };
      if (old && data.revision !== old.revision) throw new ConflictException("Пост уже отредактирован. Откройте свежую версию.");
      const revision = old ? Number(old.revision) + 1 : 1;
      if (old) await tx.query("UPDATE app.hub_posts SET title=$2,body=$3,image_url=$4,kind=$5,revision=$6,updated_by=$7,updated_at=clock_timestamp() WHERE id=$1", [data.id,data.title,data.body,data.imageUrl,data.kind,revision,actor.userId]);
      else await tx.query("INSERT INTO app.hub_posts(id,title,body,image_url,kind,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6)", [data.id,data.title,data.body,data.imageUrl,data.kind,actor.userId]);
      await tx.query("INSERT INTO app.hub_post_revisions(post_id,revision,title,body,image_url,created_by) VALUES($1,$2,$3,$4,$5,$6)", [data.id,revision,data.title,data.body,data.imageUrl,actor.userId]);
      const destinations = await this.enqueue(tx, data.id, revision);
      await this.audit.record({ action: "hub.post.saved_and_queued", actorUserId: actor.userId, actorRole: actor.role, entityType: "hub_post", entityId: data.id, metadata: { revision,destinations } }, tx);
      return { id: data.id, revision, destinations };
    });
  }
  async posts(query: unknown) {
    const { limit,offset } = parse(HubListQuerySchema, query);
    const posts = (await this.db.query(`SELECT id,revision,kind,title,body,image_url AS "imageUrl",updated_at AS "updatedAt" FROM app.hub_posts ORDER BY updated_at DESC,id LIMIT $1 OFFSET $2`, [limit,offset])).rows;
    const jobs = posts.length ? (await this.db.query(`SELECT ${jobColumns},p.post_id FROM app.hub_publications p
      JOIN app.hub_connections c ON c.id=p.connection_id JOIN LATERAL (
        SELECT * FROM app.hub_jobs h WHERE h.publication_id=p.id AND (h.state='unknown' OR h.revision > (
          SELECT COALESCE(max(revision),0)-10 FROM app.hub_jobs latest WHERE latest.publication_id=p.id
        )) ORDER BY h.revision DESC
      ) j ON true WHERE p.post_id=ANY($1::uuid[]) AND c.environment=$2 ORDER BY j.created_at DESC,j.id`, [posts.map(p=>p.id),this.environment])).rows : [];
    return { items: posts.map(p=>({ ...p,jobs: jobs.filter(j=>j.post_id === p.id) })), hasMore: posts.length === limit };
  }
  async publish(id: string, input: unknown, actor: AuthContext) {
    const data = parse(HubPublishSchema,input); uuid(id);
    return this.db.transaction(async(tx)=>{
      const post = (await tx.query("SELECT revision FROM app.hub_posts WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!post) throw new NotFoundException();
      if (post.revision !== data.revision) throw new ConflictException("Выбрана старая версия поста");
      const destinations = await this.enqueue(tx,id,data.revision,data.connectionIds);
      await this.audit.record({ action: "hub.post.queued",actorUserId: actor.userId,actorRole: actor.role,entityType: "hub_post",entityId: id,metadata: { revision: data.revision,destinations } },tx);
      return { destinations };
    });
  }
  async conversations(input: unknown) {
    const q = parse(HubListQuerySchema,input);
    const rows = (await this.db.query(`SELECT ${conversationColumns} FROM app.hub_conversations v JOIN app.hub_connections c ON c.id=v.connection_id
      LEFT JOIN app.users u ON u.id=v.assigned_to WHERE c.environment=$1 AND ($2='all' OR v.state=$2)
      AND ($3::uuid IS NULL OR c.id=$3) ORDER BY v.last_message_at DESC,v.id LIMIT $4 OFFSET $5`, [this.environment,q.state,q.connectionId ?? null,q.limit,q.offset])).rows;
    return { items: rows, hasMore: rows.length === q.limit };
  }
  async messages(id: string, input: unknown) {
    const q = parse(HubListQuerySchema,input);
    const conversation = (await this.db.query(`SELECT ${conversationColumns} FROM app.hub_conversations v JOIN app.hub_connections c ON c.id=v.connection_id
      LEFT JOIN app.users u ON u.id=v.assigned_to WHERE v.id=$1 AND c.environment=$2`, [uuid(id),this.environment])).rows[0];
    if (!conversation) throw new NotFoundException();
    const messages = (await this.db.query(`SELECT m.id,m.direction,m.sender_kind AS "senderKind",m.body,m.media,m.created_at AS "createdAt",j.state,j.id AS "jobId",j.last_error AS "lastError"
      FROM app.hub_messages m LEFT JOIN app.hub_jobs j ON j.message_id=m.id WHERE m.conversation_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2 OFFSET $3`, [id,q.limit,q.offset])).rows.reverse();
    const blockers = (await this.db.query(`SELECT m.id,m.direction,m.sender_kind AS "senderKind",m.body,m.media,m.created_at AS "createdAt",j.state,j.id AS "jobId",j.last_error AS "lastError"
      FROM app.hub_messages m JOIN app.hub_jobs j ON j.message_id=m.id WHERE m.conversation_id=$1 AND j.state='unknown' ORDER BY m.created_at,m.id`, [id])).rows;
    return { conversation, items: messages, blockers, hasMore: messages.length === q.limit };
  }
  async conversationAction(id: string, action: "assign" | "close" | "release", input: unknown, actor: AuthContext) {
    const data = parse(HubConversationActionSchema,input);
    return this.db.transaction(async(tx)=>{
      const row = (await tx.query(`SELECT v.* FROM app.hub_conversations v JOIN app.hub_connections c ON c.id=v.connection_id WHERE v.id=$1 AND c.environment=$2 FOR UPDATE OF v`, [uuid(id),this.environment])).rows[0];
      if (!row) throw new NotFoundException();
      if (row.version !== data.version) throw new ConflictException("Диалог изменился. Обновите его.");
      if (row.assigned_to && row.assigned_to !== actor.userId && actor.role === "manager") throw new ForbiddenException("Обращение уже взял другой менеджер");
      if (action === "assign" && row.state === "closed") throw new ConflictException("Обращение закрыто");
      await tx.query(`UPDATE app.hub_conversations SET state=$2,assigned_to=$3,version=version+1,unread_count=0 WHERE id=$1`,
        [id,action === "assign" ? "assigned" : action === "close" ? "closed" : "waiting",action === "assign" ? actor.userId : null]);
      // Pause bot jobs which have not left the durable queue yet.
      await tx.query(`UPDATE app.hub_jobs j SET state='failed',last_error='bot_paused',completed_at=clock_timestamp() FROM app.hub_messages m
        WHERE j.message_id=m.id AND m.conversation_id=$1 AND m.sender_kind='bot' AND j.state='queued'`, [id]);
      await this.audit.record({ action: `hub.conversation.${action}`, actorUserId: actor.userId,actorRole: actor.role,entityType: "hub_conversation",entityId: id },tx);
      return { ok: true };
    });
  }
  async reply(id: string,input: unknown,actor: AuthContext) {
    const data = parse(HubReplySchema,input);
    await this.limits.consume("hub-reply",actor.userId,60,60);
    return this.db.transaction(async(tx)=>{
      const row = (await tx.query(`SELECT v.*,c.platform,c.inbox_enabled FROM app.hub_conversations v JOIN app.hub_connections c ON c.id=v.connection_id
        WHERE v.id=$1 AND c.environment=$2 FOR UPDATE OF v`, [uuid(id),this.environment])).rows[0];
      if (!row) throw new NotFoundException();
      const duplicate = (await tx.query("SELECT id,body FROM app.hub_messages WHERE conversation_id=$1 AND client_key=$2", [id,data.clientKey])).rows[0];
      if (duplicate) { if (duplicate.body !== data.body) throw new ConflictException("Ключ отправки уже использован"); return { id: duplicate.id }; }
      if (row.state !== "assigned" || row.assigned_to !== actor.userId) throw new ConflictException("Сначала возьмите обращение в работу");
      if (!row.inbox_enabled) throw new ConflictException("Приём и ответы на этой площадке отключены");
      if (row.platform === "whatsapp" && Date.now() - new Date(row.last_inbound_at as string).getTime() >= 24*60*60*1000) throw new ConflictException("Окно ответа WhatsApp истекло. Дождитесь нового сообщения клиента.");
      const messageId = randomUUID();
      await tx.query("INSERT INTO app.hub_messages(id,conversation_id,connection_id,direction,sender_kind,sender_user_id,client_key,body) VALUES($1,$2,$3,'outgoing','operator',$4,$5,$6)", [messageId,id,row.connection_id,actor.userId,data.clientKey,data.body]);
      await tx.query("INSERT INTO app.hub_jobs(connection_id,message_id) VALUES($1,$2)", [row.connection_id,messageId]);
      await tx.query("UPDATE app.hub_conversations SET last_message_at=clock_timestamp(),last_message_preview=$2,version=version+1 WHERE id=$1", [id,data.body.slice(0,160)]);
      await this.audit.record({ action: "hub.reply.queued",actorUserId: actor.userId,actorRole: actor.role,entityType: "hub_message",entityId: messageId },tx);
      return { id: messageId };
    });
  }
  async settings() { return (await this.db.query("SELECT version,faq FROM app.hub_settings WHERE singleton")).rows[0]; }
  async saveSettings(input: unknown,actor: AuthContext) {
    const data = parse(HubFaqSchema,input);
    await this.db.transaction(async(tx)=>{
      const result = await tx.query("UPDATE app.hub_settings SET faq=$1::jsonb,version=version+1,updated_by=$2,updated_at=clock_timestamp() WHERE singleton AND version=$3 RETURNING version", [JSON.stringify(data.faq),actor.userId,data.version]);
      if (!result.rowCount) throw new ConflictException("Настройки уже изменились");
      await this.audit.record({ action: "hub.faq.saved",actorUserId: actor.userId,actorRole: actor.role,entityType: "hub_settings",metadata: { version: result.rows[0]!.version } },tx);
    });
    return this.settings();
  }
  async resolveJob(id: string,input: unknown,actor: AuthContext) {
    const data = parse(HubResolveSchema,input);
    return this.db.transaction(async(tx)=>{
      const snapshot = (await tx.query(`SELECT j.publication_id,c.environment,p.post_id FROM app.hub_jobs j JOIN app.hub_connections c ON c.id=j.connection_id
        LEFT JOIN app.hub_publications p ON p.id=j.publication_id WHERE j.id=$1`, [uuid(id)])).rows[0];
      if (!snapshot || snapshot.environment !== this.environment) throw new NotFoundException();
      // Take the post before the job, and the job before the publication
      // as the worker does when it saves a successful send.
      const post = snapshot.publication_id ? (await tx.query("SELECT revision FROM app.hub_posts WHERE id=$1 FOR UPDATE", [snapshot.post_id])).rows[0] : null;
      const job = (await tx.query(`SELECT j.*,c.platform,c.environment,p.post_id FROM app.hub_jobs j JOIN app.hub_connections c ON c.id=j.connection_id
        LEFT JOIN app.hub_publications p ON p.id=j.publication_id WHERE j.id=$1 FOR UPDATE OF j`, [id])).rows[0];
      if (!job || job.environment !== this.environment) throw new NotFoundException();
      if (job.publication_id) {
        if (job.state === "sending") throw new ConflictException("Дождитесь завершения отправки этой публикации");
        const publication = (await tx.query("SELECT applied_revision FROM app.hub_publications WHERE id=$1 FOR UPDATE", [job.publication_id])).rows[0];
        if (Number(publication?.applied_revision) >= Number(job.revision)) throw new ConflictException("Эта версия уже опубликована или заменена более новой");
        const sending = (await tx.query("SELECT 1 FROM app.hub_jobs WHERE publication_id=$1 AND state='sending' LIMIT 1", [job.publication_id])).rowCount;
        if (sending) throw new ConflictException("Дождитесь завершения отправки этой публикации");
      }
      if (data.action === "manual_done") {
        if (job.state !== "manual" || job.platform !== "whatsapp") throw new ConflictException();
        if (post?.revision !== job.revision) throw new ConflictException("Подтвердить можно только последнюю версию. Скопируйте свежий пост.");
      } else if (!["unknown","failed"].includes(job.state as string)) throw new ConflictException("Действие недоступно для этого статуса");
      if (data.action === "mark_sent" && (!job.message_id || job.state !== "unknown")) throw new ConflictException("Подтвердить отправку можно только для сообщения с неизвестным результатом");
      if (data.action === "bind" && (!job.publication_id || !data.externalId)) throw new BadRequestException("Укажите ID существующего поста");
      if (data.action === "bind" && job.platform === "telegram" && !/^\d+$/u.test(data.externalId!)) throw new BadRequestException("Нужен числовой ID сообщения");
      if (data.action === "mark_sent") {
        await tx.query("UPDATE app.hub_messages SET external_id=COALESCE($2,external_id) WHERE id=$1", [job.message_id,data.externalId ?? null]);
        await tx.query("UPDATE app.hub_jobs SET state='succeeded',last_error=NULL,completed_at=clock_timestamp() WHERE id=$1", [id]);
      } else if (data.action === "bind" || data.action === "manual_done") {
        await tx.query(`UPDATE app.hub_publications p SET external_id=COALESCE($2,external_id),applied_revision=GREATEST(applied_revision,$3),
          content_kind=CASE WHEN r.image_url IS NULL THEN 'text' ELSE 'image' END,updated_at=clock_timestamp()
          FROM app.hub_post_revisions r WHERE p.id=$1 AND r.post_id=p.post_id AND r.revision=$3`, [job.publication_id,data.externalId ?? null,job.revision]);
        await tx.query("UPDATE app.hub_jobs SET state='succeeded',last_error=NULL,completed_at=clock_timestamp() WHERE id=$1", [id]);
      } else {
        if (job.last_error === "bot_paused") throw new ConflictException("Автоответ остановлен оператором");
        await tx.query("UPDATE app.hub_jobs SET state='queued',attempt_count=0,available_at=clock_timestamp(),lease_until=NULL,claim_token=NULL,last_error=NULL WHERE id=$1", [id]);
      }
      await this.audit.record({ action: `hub.job.${data.action}`,actorUserId: actor.userId,actorRole: actor.role,entityType: "hub_job",entityId: id },tx);
      return { ok: true };
    });
  }
  async verifyChallenge(id: string,query: Record<string,unknown>) {
    const row = await this.connection(id), channel = this.channel(row);
    if (channel.platform !== "whatsapp" || !row.inbox_enabled || query["hub.mode"] !== "subscribe"
      || !secretEqual(typeof query["hub.verify_token"] === "string" ? query["hub.verify_token"] : undefined,channel.secrets.verifyToken)) throw new UnauthorizedException();
    return parse(z.string().regex(/^\d{1,100}$/u),query["hub.challenge"]);
  }
  async webhook(id: string,raw: Buffer,headers: Record<string,string|string[]|undefined>) {
    if (raw.length > HUB_WEBHOOK_MAX_BYTES) throw new BadRequestException();
    const row = await this.connection(id);
    if (!row.inbox_enabled) throw new NotFoundException();
    const channel = this.channel(row);
    let event: Record<string,unknown>;
    try { if (!verifyWebhook(channel,raw,headers)) throw new UnauthorizedException(); event = parseWebhookJson(raw); }
    catch (e) { if (e instanceof UnauthorizedException) throw e; throw new BadRequestException(); }
    await this.limits.consume("hub-webhook",id,600,60);
    if (channel.platform === "max" && event.update_type === "bot_added") {
      // Remember channels the bot was added to, so «Проверить» can show their IDs.
      const chat = identifier(event.chat_id);
      if (/^-?\d+$/u.test(chat)) await this.db.query("INSERT INTO app.hub_events(connection_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id,`max_chat:${chat}`]);
      return { ok: true };
    }
    if (channel.platform === "vk" && event.type === "confirmation") {
      if (!channel.secrets.confirmationCode) throw new BadRequestException("confirmation_not_configured");
      return channel.secrets.confirmationCode;
    }
    for (const incoming of normalizeIncoming(channel,event)) await this.db.transaction(async(tx)=>{
      const current = (await tx.query<Connection>("SELECT * FROM app.hub_connections WHERE id=$1 FOR SHARE", [id])).rows[0];
      if (!current?.inbox_enabled || current.version !== row.version || current.environment !== this.environment) throw new ConflictException("Подключение изменилось. Повторите доставку события.");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hub-peer:${id}:${incoming.peerId}`]);
      const accepted = await tx.query("INSERT INTO app.hub_events(connection_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [id,incoming.eventId || incoming.externalId]);
      if (!accepted.rowCount) return;
      if (incoming.edited) {
        await tx.query("UPDATE app.hub_messages SET body=$3,media=$4::jsonb WHERE connection_id=$1 AND external_id=$2 AND direction='incoming'", [id,incoming.externalId,incoming.body,JSON.stringify(incoming.media)]);
        return;
      }
      const conversation = (await tx.query(`INSERT INTO app.hub_conversations(connection_id,peer_id,customer_name,last_inbound_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(connection_id,peer_id) DO UPDATE SET customer_name=EXCLUDED.customer_name RETURNING *`, [id,incoming.peerId,incoming.customerName,incoming.timestamp])).rows[0]!;
      const inserted = await tx.query(`INSERT INTO app.hub_messages(conversation_id,connection_id,direction,sender_kind,external_id,body,media)
        VALUES($1,$2,'incoming','customer',$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [conversation.id,id,incoming.externalId,incoming.body,JSON.stringify(incoming.media)]);
      if (!inserted.rowCount) return;
      const bot = conversation.state === "bot" || conversation.state === "closed";
      const faq = bot ? (await tx.query<{ faq: FaqRule[] }>("SELECT faq FROM app.hub_settings WHERE singleton")).rows[0]!.faq : [];
      const decision = bot ? botDecision(incoming.body,faq) : null;
      let autoReply = !!decision;
      if (decision && !decision.handoff) {
        const recent = (await tx.query(`SELECT 1 FROM app.hub_messages m LEFT JOIN app.hub_jobs j ON j.message_id=m.id
          WHERE m.conversation_id=$1 AND m.sender_kind='bot' AND (m.created_at > clock_timestamp()-interval '15 seconds' OR j.state IN ('queued','sending')) LIMIT 1`, [conversation.id])).rowCount;
        autoReply = !recent;
      }
      if (autoReply) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hub-bot-budget:${id}`]);
      const overloaded = autoReply && Number((await tx.query<{ count: string }>(`SELECT count(*) FROM app.hub_jobs j JOIN app.hub_messages m ON m.id=j.message_id
        WHERE j.connection_id=$1 AND m.sender_kind='bot' AND j.state IN ('queued','sending')`, [id])).rows[0]!.count) >= 100;
      if (overloaded) autoReply = false;
      await tx.query(`UPDATE app.hub_conversations SET last_inbound_at=GREATEST(last_inbound_at,$2),last_message_at=clock_timestamp(),last_message_preview=$3,
        unread_count=unread_count+1,state=$4,assigned_to=CASE WHEN $5 THEN NULL ELSE assigned_to END,version=version+1 WHERE id=$1`,
      [conversation.id,incoming.timestamp,incoming.body.slice(0,160),overloaded ? "waiting" : decision ? decision.handoff ? "waiting" : "bot" : conversation.state,bot]);
      if (decision && autoReply && (channel.platform !== "whatsapp" || Date.now()-incoming.timestamp.getTime()<24*60*60*1000)) {
        const message = (await tx.query("INSERT INTO app.hub_messages(conversation_id,connection_id,direction,sender_kind,body) VALUES($1,$2,'outgoing','bot',$3) RETURNING id", [conversation.id,id,decision.body])).rows[0]!;
        await tx.query("INSERT INTO app.hub_jobs(connection_id,message_id) VALUES($1,$2)", [id,message.id]);
      }
    });
    return channel.platform === "vk" ? "ok" : { ok: true };
  }
}
