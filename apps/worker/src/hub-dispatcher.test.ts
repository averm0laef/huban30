import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DeliveryError } from "@an30/messaging";
import { HubDispatcher } from "./hub-dispatcher.js";

const keyMaterial="test-only-key-material-at-least-32-characters";
function encrypt() {
  const key=Buffer.from(hkdfSync("sha256",Buffer.from(keyMaterial),Buffer.from("an30-security-v1"),Buffer.from("aes-256-gcm"),32));
  const nonce=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(Buffer.from("hub:connection-1"));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify({token:"private-test-token"})),cipher.final()]);
  return Buffer.concat([Buffer.from([1]),nonce,cipher.getAuthTag(),ciphertext]);
}
type Row=Record<string,unknown>;
/** Small persistence double: exercises lifecycle and provider calls, while
 * the HTTP smoke suite verifies real PostgreSQL locking/queue selection. */
class QueueStore {
  state="queued"; claimToken=""; error:string|null=null; environment="production";
  failPersistence=false; failSecondClaim=false; claims=0;
  connection:Row={id:"connection-1",platform:"telegram",environment:"production",is_test:false,publish_target:"@channel",inbox_target:"",encrypted_credentials:encrypt(),publish_enabled:true,inbox_enabled:true};
  job:Row={id:"job-1",connection_id:"connection-1",publication_id:"publication-1",message_id:null,revision:1,attempt_count:0};
  publication:Row={external_id:null,applied_revision:0,content_kind:null,title:"Новое поступление",body:"Фильтры",image_url:null};
  message:Row={body:"Ответ",sender_kind:"operator",peer_id:"123",state:"assigned",last_inbound_at:new Date()};
  delay=0;
  query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    const rows=(items:Row[]=[])=>({rows:items,rowCount:items.length});
    if (sql.startsWith("SELECT environment")) return rows([{environment:this.environment}]);
    if (sql.includes("SET state='unknown'") && sql.includes("FROM app.hub_connections")) return rows();
    if (sql.includes("SELECT c.*")) {
      this.claims++;
      if (this.failSecondClaim && this.claims===2) throw new Error("database interrupted");
      return rows(this.state === "queued" ? [this.connection]:[]);
    }
    if (sql.includes("SELECT j.*")) return rows([{...this.job}]);
    if (sql.includes("SET state='sending'")) { this.state="sending";this.claimToken=values[1] as string;this.job.attempt_count=Number(this.job.attempt_count)+1;return rows(); }
    if (sql.includes("SELECT p.external_id")) return rows([this.publication]);
    if (sql.includes("SELECT m.body")) return rows([this.message]);
    if (sql.includes("UPDATE app.hub_jobs SET state='succeeded'")) {
      if (this.failPersistence) throw new Error("disk temporarily unavailable");
      if (this.state !== "sending" || this.claimToken !== values[1]) return rows();
      this.state="succeeded";return rows([{id:"job-1"}]);
    }
    if (sql.includes("UPDATE app.hub_publications SET")) { this.publication.external_id=values[1];this.publication.applied_revision=values[2];this.publication.content_kind=values[3];return rows(); }
    if (sql.includes("UPDATE app.hub_messages SET")) { this.message.external_id=values[1];return rows(); }
    if (sql.includes("UPDATE app.hub_jobs SET state=$3")) {
      if (this.state === "sending" && this.claimToken === values[1]) {this.state=values[2] as string;this.error=values[3] as string|null;this.delay=Number(values[4]);}
      return rows();
    }
    return rows();
  });
  pool={query:this.query,connect:async()=>({query:this.query,release:vi.fn()})} as unknown as Pool;
}
function setup(environment="production",emulated=false) {
  const store=new QueueStore(), transport={publish:vi.fn().mockResolvedValue("77"),reply:vi.fn().mockResolvedValue("88")}, logger={error:vi.fn(),info:vi.fn()};
  store.environment=environment;
  const dispatcher=new HubDispatcher(store.pool,keyMaterial,environment,logger,transport,emulated);
  return {store,transport,logger,dispatcher};
}

describe("durable messenger dispatch",()=>{
  it("claims durably before sending and commits the external ID and revision",async()=>{
    const {store,transport,dispatcher}=setup();
    transport.publish.mockImplementation(async()=>{expect(store.state).toBe("sending");expect(store.claimToken).toBeTruthy();return "77";});
    await dispatcher.poll();
    expect(store.state).toBe("succeeded");
    expect(store.publication).toMatchObject({external_id:"77",applied_revision:1,content_kind:"text"});
    expect(transport.publish).toHaveBeenCalledWith(expect.objectContaining({platform:"telegram"}),expect.objectContaining({title:"Новое поступление"}),"job-1",null);
  });
  it("keeps simulated channels entirely offline and preserves their post identity on edits",async()=>{
    const {store,transport,dispatcher}=setup();store.connection.is_test=true;
    await dispatcher.poll();
    expect(store.publication.external_id).toBe("test-publication-1");
    store.job.revision=2;store.state="queued";
    await dispatcher.poll();
    expect(store.publication).toMatchObject({external_id:"test-publication-1",applied_revision:2});
    expect(transport.publish).not.toHaveBeenCalled();expect(transport.reply).not.toHaveBeenCalled();
  });
  it("does not resend an older revision after a newer version was applied",async()=>{
    const {store,transport,dispatcher}=setup();store.publication.external_id="77";store.publication.applied_revision=3;
    await dispatcher.poll();
    expect(store.state).toBe("succeeded");expect(store.publication.applied_revision).toBe(3);expect(transport.publish).not.toHaveBeenCalled();
  });
  it("edits an existing publication using the persisted ID",async()=>{
    const {store,transport,dispatcher}=setup();store.publication.external_id="77";store.publication.applied_revision=1;store.job.revision=2;
    await dispatcher.poll();
    expect(transport.publish).toHaveBeenCalledWith(expect.anything(),expect.anything(),"job-1","77");
    expect(store.publication.applied_revision).toBe(2);
  });
  it("blocks unsupported Telegram photo removal without deleting/reposting",async()=>{
    const {store,transport,dispatcher}=setup();store.publication.external_id="77";store.publication.content_kind="image";store.publication.applied_revision=1;store.job.revision=2;
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.error).toBe("telegram_photo_cannot_be_removed");expect(transport.publish).not.toHaveBeenCalled();
  });
  it("holds an uncertain send for human reconciliation across subsequent polls",async()=>{
    const {store,transport,dispatcher}=setup();transport.publish.mockRejectedValue(new DeliveryError("provider_result_unknown",true));
    await dispatcher.poll();await dispatcher.poll();
    expect(store.state).toBe("unknown");expect(store.error).toBe("provider_result_unknown");expect(transport.publish).toHaveBeenCalledTimes(1);
  });
  it("retries explicit rate-limit rejection but caps automatic attempts",async()=>{
    const {store,transport,dispatcher}=setup();transport.publish.mockRejectedValue(new DeliveryError("provider_rejected_429",false,30));
    await dispatcher.poll();expect(store.state).toBe("queued");
    store.job.attempt_count=4;
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.job.attempt_count).toBe(5);
  });
  it("does not call a failed authenticated request an uncertain send",async()=>{
    const {store,transport,dispatcher}=setup();transport.publish.mockRejectedValue(new DeliveryError("provider_rejected_401"));
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.error).toBe("provider_rejected_401");
  });
  it("marks persistence failure after receiving a provider ID as unknown",async()=>{
    const {store,transport,dispatcher}=setup();store.failPersistence=true;
    await dispatcher.poll();expect(store.state).toBe("unknown");expect(store.error).toBe("persistence_result_unknown");expect(transport.publish).toHaveBeenCalledTimes(1);
  });
  it("does not let a stale claim overwrite a reconciled job",async()=>{
    const {store,transport,dispatcher}=setup();
    transport.publish.mockImplementation(async()=>{store.state="unknown";store.claimToken="new-claim";return "77";});
    await dispatcher.poll();expect(store.state).toBe("unknown");expect(store.publication.external_id).toBeNull();
  });
  it("continues already claimed work if a subsequent queue claim fails",async()=>{
    const {store,transport,dispatcher}=setup();store.failSecondClaim=true;
    await dispatcher.poll();expect(store.state).toBe("succeeded");expect(transport.publish).toHaveBeenCalledTimes(1);
  });
  it("rejects a deployment mismatch before claiming or sending any work",async()=>{
    const {store,transport,logger,dispatcher}=setup();store.environment="development";
    await dispatcher.poll();expect(store.claims).toBe(0);expect(store.state).toBe("queued");expect(transport.publish).not.toHaveBeenCalled();expect(logger.error).toHaveBeenCalled();
  });
  it.each(["assigned","closed"])("suppresses bot replies after operator state becomes %s",async state=>{
    const {store,transport,dispatcher}=setup();store.job.publication_id=null;store.job.message_id="message-1";store.job.revision=null;store.message.sender_kind="bot";store.message.state=state;
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.error).toBe("bot_paused");expect(transport.reply).not.toHaveBeenCalled();
  });
  it("enforces WhatsApp's 24-hour window again at actual dispatch time",async()=>{
    const {store,transport,dispatcher}=setup();store.connection.platform="whatsapp";store.job.publication_id=null;store.job.message_id="message-1";store.job.revision=null;store.message.last_inbound_at=new Date(Date.now()-25*60*60*1000);
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.error).toBe("whatsapp_reply_window_expired");expect(transport.reply).not.toHaveBeenCalled();
  });
  it("returns a manager reply to the stored originating peer and records its external message",async()=>{
    const {store,transport,dispatcher}=setup();store.job.publication_id=null;store.job.message_id="message-1";store.job.revision=null;
    await dispatcher.poll();expect(store.state).toBe("succeeded");expect(transport.reply).toHaveBeenCalledWith(expect.anything(),"123","Ответ","job-1");expect(store.message.external_id).toBe("88");
  });
  it("waits for an in-flight send to finish during shutdown and never starts more work",async()=>{
    const {store,transport,dispatcher}=setup();let release:()=>void=()=>{};
    transport.publish.mockImplementation(()=>new Promise<string>(resolve=>{release=()=>resolve("77");}));
    const poll=dispatcher.poll();
    await vi.waitFor(()=>expect(transport.publish).toHaveBeenCalled());
    let stopped=false;const stop=dispatcher.stop().then(()=>{stopped=true;});
    expect(stopped).toBe(false);release();await poll;await stop;
    store.state="queued";await dispatcher.poll();expect(transport.publish).toHaveBeenCalledTimes(1);
  });
  it("retries an uncertain but idempotent send (edit, VK guid/random_id) and stops at the attempt cap",async()=>{
    const {store,transport,dispatcher}=setup();transport.publish.mockRejectedValue(new DeliveryError("provider_result_unknown",true,0,true));
    await dispatcher.poll();expect(store.state).toBe("queued");expect(store.error).toBe("provider_result_unknown");expect(store.delay).toBeGreaterThanOrEqual(15);
    store.job.attempt_count=4;
    await dispatcher.poll();expect(store.state).toBe("unknown");expect(transport.publish).toHaveBeenCalledTimes(2);
  });
  it("refuses to add a photo to a published Telegram text post instead of failing at Telegram",async()=>{
    const {store,transport,dispatcher}=setup();store.publication.external_id="77";store.publication.content_kind="text";store.publication.applied_revision=1;store.publication.image_url="https://images.example.com/a.png";store.job.revision=2;
    await dispatcher.poll();expect(store.state).toBe("failed");expect(store.error).toBe("telegram_photo_cannot_be_added");expect(transport.publish).not.toHaveBeenCalled();
  });
  it("keeps live sends off outside production unless every call goes to the local emulator",async()=>{
    const blocked=setup("development");
    await blocked.dispatcher.poll();expect(blocked.store.state).toBe("failed");expect(blocked.store.error).toBe("live_delivery_disabled");expect(blocked.transport.publish).not.toHaveBeenCalled();
    const emulated=setup("development",true);
    await emulated.dispatcher.poll();expect(emulated.store.state).toBe("succeeded");expect(emulated.transport.publish).toHaveBeenCalledTimes(1);
  });
});
