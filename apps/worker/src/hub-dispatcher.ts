import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import type { HubPlatform, HubSecrets } from "@an30/contracts";
import { DeliveryError, MessengerClient, messengerFromEnvironment, type Channel } from "@an30/messaging";
import { decryptSecret } from "./secret-crypto.js";

type Job = { id: string; connection_id: string; publication_id: string | null; message_id: string | null; revision: number | null;
  claim_token: string; attempt_count: number; platform: HubPlatform; is_test: boolean; publish_target: string; inbox_target: string; encrypted_credentials: Buffer };

export const HUB_JOB_PRIORITY_SQL = "CASE WHEN m.sender_kind='operator' THEN 0 WHEN j.message_id IS NOT NULL THEN 1 ELSE 2 END";

/** The database is the queue of record: enqueue and business changes commit together. */
export class HubDispatcher {
  private running = false;
  private stopping = false;
  private environmentVerified = false;
  private readonly transport: Pick<MessengerClient,"publish"|"reply">;
  /** True when HUB_PROVIDER_EMULATOR_URL routes every send to a local emulator. */
  private readonly emulated: boolean;
  constructor(private readonly db: Pool, private readonly key: string, private readonly environment: string,
    private readonly logger: Pick<Logger,"error"|"info">, transport?: Pick<MessengerClient,"publish"|"reply">, emulated = false) {
    if (transport) { this.transport = transport; this.emulated = emulated; }
    else { const configured = messengerFromEnvironment(process.env, environment); this.transport = configured.client; this.emulated = configured.emulated; }
  }
  async stop() { this.stopping = true; while (this.running) await new Promise(resolve=>setTimeout(resolve,50)); }
  async poll() {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      if (!this.environmentVerified) {
        const deployment=(await this.db.query<{environment:string}>("SELECT environment FROM app.deployment_settings WHERE singleton")).rows[0];
        if (deployment?.environment !== this.environment) throw new Error("hub_environment_mismatch");
        this.environmentVerified = true;
      }
      await this.db.query(`UPDATE app.hub_jobs j SET state='unknown',last_error='worker_interrupted_check_provider',lease_until=NULL
        FROM app.hub_connections c WHERE c.id=j.connection_id AND c.environment=$1 AND j.state='sending' AND j.lease_until < clock_timestamp()`,[this.environment]);
      // One send per connection at a time, several independent platforms in parallel.
      const jobs: Job[] = [];
      for (let i=0;i<4;i++) {
        try { const job = await this.claim(); if (!job) break; jobs.push(job); }
        catch { this.logger.error({component:"client-hub"},"Hub claim failed; already claimed jobs will still be processed"); break; }
      }
      const results=await Promise.allSettled(jobs.map(job=>this.deliver(job)));
      if (results.some(result=>result.status === "rejected")) this.logger.error({ component:"client-hub" },"Hub send result could not be persisted; lease reconciliation required");
    } catch { this.logger.error({ component: "client-hub" },"Hub queue unavailable; jobs remain durable"); }
    finally { this.running = false; }
  }
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>) {
    const tx=await this.db.connect();
    try { await tx.query("BEGIN"); await tx.query("SET LOCAL lock_timeout='3s'"); const result=await work(tx); await tx.query("COMMIT"); return result; }
    catch(e) { await tx.query("ROLLBACK"); throw e; } finally { tx.release(); }
  }
  private claim(): Promise<Job | null> {
    return this.transaction(async(tx)=>{
      const connection=(await tx.query(`SELECT c.* FROM app.hub_connections c
        WHERE c.environment=$1 AND c.next_send_at <= clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM app.hub_jobs s WHERE s.connection_id=c.id AND s.state='sending')
        AND EXISTS(SELECT 1 FROM app.hub_jobs j WHERE j.connection_id=c.id AND j.state='queued' AND j.available_at<=clock_timestamp()
          AND ((j.publication_id IS NOT NULL AND c.publish_enabled) OR (j.message_id IS NOT NULL AND c.inbox_enabled))
          AND NOT EXISTS(SELECT 1 FROM app.hub_jobs uncertain LEFT JOIN app.hub_messages um ON um.id=uncertain.message_id
            LEFT JOIN app.hub_messages current_message ON current_message.id=j.message_id
            WHERE uncertain.state='unknown' AND (uncertain.publication_id=j.publication_id OR (current_message.conversation_id IS NOT NULL AND um.conversation_id=current_message.conversation_id)))
          AND NOT EXISTS(SELECT 1 FROM app.hub_jobs prior LEFT JOIN app.hub_messages pm ON pm.id=prior.message_id
            LEFT JOIN app.hub_messages current_message ON current_message.id=j.message_id
            WHERE prior.state IN ('queued','sending') AND (prior.created_at,prior.id)<(j.created_at,j.id)
              AND (prior.publication_id=j.publication_id OR (current_message.conversation_id IS NOT NULL AND pm.conversation_id=current_message.conversation_id))))
        ORDER BY c.next_send_at,c.id FOR UPDATE SKIP LOCKED LIMIT 1`,[this.environment])).rows[0];
      if (!connection) return null;
      const job=(await tx.query(`SELECT j.* FROM app.hub_jobs j LEFT JOIN app.hub_messages m ON m.id=j.message_id
        WHERE j.connection_id=$1 AND j.state='queued' AND j.available_at<=clock_timestamp()
        AND ((j.publication_id IS NOT NULL AND $2) OR (j.message_id IS NOT NULL AND $3))
        AND NOT EXISTS(SELECT 1 FROM app.hub_jobs uncertain LEFT JOIN app.hub_messages um ON um.id=uncertain.message_id
          WHERE uncertain.state='unknown' AND (uncertain.publication_id=j.publication_id OR (m.conversation_id IS NOT NULL AND um.conversation_id=m.conversation_id)))
        AND NOT EXISTS(SELECT 1 FROM app.hub_jobs prior LEFT JOIN app.hub_messages pm ON pm.id=prior.message_id
          WHERE prior.state IN ('queued','sending') AND (prior.created_at,prior.id)<(j.created_at,j.id)
            AND (prior.publication_id=j.publication_id OR (m.conversation_id IS NOT NULL AND pm.conversation_id=m.conversation_id)))
        ORDER BY ${HUB_JOB_PRIORITY_SQL},j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,[connection.id,connection.publish_enabled,connection.inbox_enabled])).rows[0];
      // Do not repeatedly pick a connection whose only jobs need reconciliation.
      await tx.query("UPDATE app.hub_connections SET next_send_at=clock_timestamp()+interval '1 second' WHERE id=$1",[connection.id]);
      if (!job) return null;
      const token=randomUUID();
      await tx.query(`UPDATE app.hub_jobs SET state='sending',claim_token=$2,attempt_count=LEAST(5,attempt_count+1),lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1`,[job.id,token]);
      return { ...connection,...job,claim_token:token,attempt_count:Number(job.attempt_count)+1 } as Job;
    });
  }
  private async deliver(job:Job) {
    let externalId: string | null = null;
    try {
      if (!job.is_test && this.environment !== "production" && !this.emulated) throw new DeliveryError("live_delivery_disabled");
      const channel:Channel={platform:job.platform,publishTarget:job.publish_target,inboxTarget:job.inbox_target,
        secrets:JSON.parse(decryptSecret(job.encrypted_credentials.toString("base64url"),this.key,`hub:${job.connection_id}`)) as HubSecrets};
      if (job.publication_id) {
        const row=(await this.db.query(`SELECT p.external_id,p.applied_revision,p.content_kind,r.title,r.body,r.image_url
          FROM app.hub_publications p JOIN app.hub_post_revisions r ON r.post_id=p.post_id AND r.revision=$2 WHERE p.id=$1`,[job.publication_id,job.revision])).rows[0];
        if (!row) throw new DeliveryError("post_revision_missing");
        if (Number(row.applied_revision)>=Number(job.revision)) { await this.finish(job,"succeeded",null); return; }
        if (job.platform === "telegram" && row.external_id && row.content_kind === "image" && !row.image_url) throw new DeliveryError("telegram_photo_cannot_be_removed");
        // Telegram cannot turn a text message into a photo message either.
        if (job.platform === "telegram" && row.external_id && row.content_kind === "text" && row.image_url) throw new DeliveryError("telegram_photo_cannot_be_added");
        externalId=job.is_test ? row.external_id as string || `test-${job.publication_id}` : await this.transport.publish(channel,{ title:row.title as string,body:row.body as string,imageUrl:row.image_url as string|null },job.id,row.external_id as string|null);
        await this.transaction(async(tx)=>{
          const done=await tx.query(`UPDATE app.hub_jobs SET state='succeeded',last_error=NULL,completed_at=clock_timestamp(),lease_until=NULL
            WHERE id=$1 AND state='sending' AND claim_token=$2 RETURNING id`,[job.id,job.claim_token]);
          if (done.rowCount) await tx.query(`UPDATE app.hub_publications SET external_id=$2,applied_revision=$3,content_kind=$4,updated_at=clock_timestamp() WHERE id=$1`,[job.publication_id,externalId,job.revision,row.image_url ? "image":"text"]);
        });
      } else {
        const message=(await this.db.query(`SELECT m.body,m.sender_kind,v.peer_id,v.state,v.last_inbound_at FROM app.hub_messages m
          JOIN app.hub_conversations v ON v.id=m.conversation_id WHERE m.id=$1`,[job.message_id])).rows[0];
        if (!message) throw new DeliveryError("message_missing");
        if (message.sender_kind === "bot" && ["assigned","closed"].includes(message.state as string)) throw new DeliveryError("bot_paused");
        if (job.platform === "whatsapp" && Date.now()-new Date(message.last_inbound_at as string).getTime()>=24*60*60*1000) throw new DeliveryError("whatsapp_reply_window_expired");
        externalId=job.is_test ? `test-${job.message_id}` : await this.transport.reply(channel,message.peer_id as string,message.body as string,job.id);
        await this.transaction(async(tx)=>{
          const done=await tx.query(`UPDATE app.hub_jobs SET state='succeeded',last_error=NULL,completed_at=clock_timestamp(),lease_until=NULL
            WHERE id=$1 AND state='sending' AND claim_token=$2 RETURNING id`,[job.id,job.claim_token]);
          if (done.rowCount) await tx.query("UPDATE app.hub_messages SET external_id=$2 WHERE id=$1",[job.message_id,externalId]);
        });
      }
    } catch(error) {
      // Any failure after a provider returned an ID is still an uncertain send.
      const failure=externalId ? new DeliveryError("persistence_result_unknown",true) : error instanceof DeliveryError ? error : new DeliveryError("delivery_internal_error");
      // An uncertain result is retried only when the provider deduplicates it
      // (edits, VK guid/random_id); otherwise a person checks the platform.
      const repeat=failure.uncertain && failure.repeatable && job.attempt_count<5;
      const retry=repeat || (!failure.uncertain && failure.retryAfter>0 && job.attempt_count<5);
      const state=repeat || retry ? "queued" : failure.uncertain ? "unknown" : "failed";
      await this.finish(job,state,failure.code,repeat ? Math.max(failure.retryAfter,15*job.attempt_count) : retry ? failure.retryAfter:0);
    }
  }
  private async finish(job:Job,state:string,error:string|null,delay=0) {
    await this.db.query(`UPDATE app.hub_jobs SET state=$3,last_error=$4,lease_until=NULL,available_at=clock_timestamp()+($5*interval '1 second'),
      completed_at=CASE WHEN $3 IN ('succeeded','failed') THEN clock_timestamp() ELSE NULL END WHERE id=$1 AND state='sending' AND claim_token=$2`,[job.id,job.claim_token,state,error,delay]);
  }
}
