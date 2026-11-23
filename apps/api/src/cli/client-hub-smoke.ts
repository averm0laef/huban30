import assert from "node:assert/strict";
import { createHmac,randomUUID } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { Client } from "pg";
import { ConfigService } from "@nestjs/config";
import { validateEnvironment } from "../config.js";
import { CryptoService } from "../security/crypto.service.js";
import { TotpService } from "../security/totp.service.js";
import type { HubConnectionView,HubConversationView,HubMessageView,HubPostView,HubPlatform,HubSecrets } from "@an30/contracts";

/** Real HTTP + isolated PostgreSQL + running worker; no provider network calls. */
async function main() {
  const config=validateEnvironment(process.env);
  assert.equal(config.DEPLOYMENT_ENVIRONMENT,"development");
  assert.equal(config.AUTH_DEBUG_TOKENS,true);
  assert.match(config.APP_ORIGIN,/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u);
  assert.ok(process.env.HUB_PREVIEW_PASSWORD_FILE,"A dedicated local preview password file is required");
  const base=`http://127.0.0.1:${config.PORT}/api/v1`,cookies=new Map<string,string>();
  const db=new Client({connectionString:config.DATABASE_URL});await db.connect();
  const crypto=new CryptoService(new ConfigService(config)),totp=new TotpService();
  let csrf="",checks=0;
  const check=(condition:unknown,message:string)=>{assert.ok(condition,message);checks++;};
  async function request<T>(path:string,body?:unknown,status=body === undefined ? 200:201,headers:Record<string,string>={}) {
    const response=await fetch(`${base}${path}`,{method:body === undefined ? "GET":"POST",headers:{
      cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; "),origin:config.APP_ORIGIN,"x-csrf-token":csrf,
      ...(body === undefined ? {}:{"content-type":"application/json"}),...headers,
    },...(body === undefined ? {}:{body:JSON.stringify(body)})});
    for (const line of response.headers.getSetCookie()) { const pair=line.split(";")[0]!,i=pair.indexOf("=");cookies.set(pair.slice(0,i),pair.slice(i+1)); }
    const text=await response.text();
    assert.equal(response.status,status,`${path}: ${response.status} ${text.slice(0,400)}`);
    return (response.headers.get("content-type")?.includes("json") ? JSON.parse(text):text) as T;
  }
  async function eventually(test:()=>Promise<boolean>,label:string) {
    const end=Date.now()+20_000;
    while (Date.now()<end) {if(await test()){checks++;return;}await new Promise(resolve=>setTimeout(resolve,200));}
    throw new Error(`Timed out: ${label}`);
  }
  const queryCount=async(sql:string,values:unknown[])=>Number((await db.query<{n:string}>(sql,values)).rows[0]!.n);
  try {
    const login=await request<{csrfToken:string;userId:string;totpSetupRequired:boolean}>("/auth/login",{email:"hub-preview@example.invalid",password:readFileSync(process.env.HUB_PREVIEW_PASSWORD_FILE!,"utf8").trim()});csrf=login.csrfToken;
    let secret:string;
    if(login.totpSetupRequired) {
      secret=(await request<{secret:string}>("/auth/totp/setup",{})).secret;
      csrf=(await request<{csrfToken:string}>("/auth/totp/confirm",{code:totp.generateCode(secret)})).csrfToken;
    } else {
      const row=(await db.query<{totp_secret_ciphertext:Buffer}>("SELECT totp_secret_ciphertext FROM app.staff_members WHERE user_id=$1",[login.userId])).rows[0]!;
      secret=crypto.decrypt(row.totp_secret_ciphertext,`totp:${login.userId}`);
      // Repeated smoke runs use the next valid step; no MFA bypass in application code.
      const used=(await db.query<{totp_last_used_step:string|null}>("SELECT totp_last_used_step FROM app.staff_members WHERE user_id=$1",[login.userId])).rows[0]!.totp_last_used_step;
      if(Number(used)>=Math.floor(Date.now()/30_000)) await new Promise(resolve=>setTimeout(resolve,30_100-Date.now()%30_000));
      csrf=(await request<{csrfToken:string}>("/auth/totp/verify",{code:totp.generateCode(secret)})).csrfToken;
    }
    mkdirSync("/tmp/an30-client-hub-20261118",{recursive:true,mode:0o700});
    writeFileSync("/tmp/an30-client-hub-20261118/preview-access.json",JSON.stringify({email:"hub-preview@example.invalid",passwordFile:process.env.HUB_PREVIEW_PASSWORD_FILE,totpSecret:secret,cookies:[...cookies].map(([name,value])=>({name,value,url:config.APP_ORIGIN}))},null,2),{mode:0o600});
    const run=randomUUID().slice(0,8),ids={} as Record<HubPlatform,string>,secrets={} as Record<HubPlatform,HubSecrets>;
    for(const platform of ["telegram","vk","max","whatsapp"] as const) {
      const id=randomUUID();ids[platform]=id;
      secrets[platform]={token:`local-simulation-${randomUUID()}`,publishingToken:`local-simulation-${randomUUID()}`,webhookSecret:randomUUID().replaceAll("-",""),appSecret:randomUUID(),verifyToken:randomUUID(),confirmationCode:"local-confirmation"};
      await request("/client-hub/connections",{id,platform,name:`${platform} · проверка ${run}`,isTest:true,publishEnabled:true,inboxEnabled:true,
        publishTarget:platform === "vk" ? `-${Date.now()}`:`test-${run}-${platform}`,inboxTarget:platform === "telegram" ? "":`${Date.now()}${platform.length}`,secrets:secrets[platform]});
    }
    const connections=(await request<{items:HubConnectionView[]}>("/client-hub/connections")).items;
    check(!JSON.stringify(connections).includes(secrets.telegram.token!),"Credentials never appear in connection views");
    await request(`/client-hub/connections/${ids.telegram}/activate`,{version:1,confirmed:true},400);
    const post={id:randomUUID(),kind:"arrival",title:"Проверка публикации АН30",body:"Тестовый пост. Отправка имитируется: в реальных каналах он не появится.",imageUrl:null};
    const [saved,replayed]=await Promise.all([request<{id:string;revision:number}>("/client-hub/posts",post),request<{id:string;revision:number}>("/client-hub/posts",post)]);
    check(saved.id===replayed.id && saved.revision===1 && replayed.revision===1,"Concurrent save does not duplicate a post/revision");
    check(await queryCount("SELECT count(*) n FROM app.hub_post_revisions WHERE post_id=$1",[post.id])===1,"One immutable revision");
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_jobs j JOIN app.hub_publications p ON p.id=j.publication_id WHERE p.post_id=$1 AND j.connection_id=ANY($2::uuid[]) AND j.state='succeeded'",[post.id,[ids.telegram,ids.vk,ids.max]])===3,"Three simulated automatic publications");
    await request("/client-hub/posts",{...post,revision:1,body:"Тестовая версия 2. Проверяем редактирование уже опубликованных записей."});
    await request("/client-hub/posts",{...post,revision:1,body:"Конфликтующая версия"},409);
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_publications WHERE post_id=$1 AND connection_id=ANY($2::uuid[]) AND applied_revision=2",[post.id,[ids.telegram,ids.vk,ids.max]])===3,"Edits applied to existing publications");
    check(await queryCount("SELECT count(*) n FROM app.hub_publications WHERE post_id=$1 AND connection_id=ANY($2::uuid[])",[post.id,Object.values(ids)])===4,"One publication per destination across edits");
    const manual=(await db.query<{id:string;revision:number}>("SELECT j.id,j.revision FROM app.hub_jobs j JOIN app.hub_publications p ON p.id=j.publication_id WHERE p.post_id=$1 AND j.connection_id=$2 ORDER BY revision",[post.id,ids.whatsapp])).rows;
    await request(`/client-hub/jobs/${manual[0]!.id}/resolve`,{action:"manual_done",confirmed:true},409);
    await request(`/client-hub/jobs/${manual[1]!.id}/resolve`,{action:"manual_done",confirmed:true});checks++;
    async function incoming(platform:HubPlatform,number:number,body="Нужен фильтр для автомобиля") {
      const conn=connections.find(c=>c.id===ids[platform])!,peer=`610000${platform.length}`,timestamp=Math.floor(Date.now()/1000);
      const event=platform === "telegram" ? {update_id:number,message:{message_id:number,date:timestamp,chat:{id:peer,type:"private"},from:{first_name:"Тестовый клиент"},text:body}}:
        platform === "vk" ? {type:"message_new",group_id:conn.inboxTarget,secret:secrets.vk.webhookSecret,event_id:`event-${number}`,object:{message:{conversation_message_id:number,peer_id:peer,from_id:peer,date:timestamp,text:body,out:0}}}:
        platform === "max" ? {update_type:"message_created",timestamp:Date.now(),message:{timestamp:Date.now(),sender:{user_id:peer,first_name:"Тестовый клиент"},recipient:{chat_type:"dialog",chat_id:peer},body:{mid:`mid-${number}`,text:body}}}:
        {entry:[{changes:[{value:{metadata:{phone_number_id:conn.inboxTarget},contacts:[{wa_id:peer,profile:{name:"Тестовый клиент"}}],messages:[{id:`wamid-${number}`,from:peer,timestamp,type:"text",text:{body}}]}}]}]};
      const raw=JSON.stringify(event),headers:Record<string,string>=platform === "telegram" ? {"x-telegram-bot-api-secret-token":secrets.telegram.webhookSecret!}:platform === "max" ? {"x-max-bot-api-secret":secrets.max.webhookSecret!}:platform === "whatsapp" ? {"x-hub-signature-256":`sha256=${createHmac("sha256",secrets.whatsapp.appSecret!).update(raw).digest("hex")}`} : {};
      await request(`/client-hub/webhooks/${ids[platform]}`,event,200,headers);
      return {event,headers};
    }
    for(const platform of ["telegram","vk","max","whatsapp"] as const) {
      const {event,headers}=await incoming(platform,1);
      await request(`/client-hub/webhooks/${ids[platform]}`,event,200,headers);
      let conversation=(await request<{items:HubConversationView[]}>(`/client-hub/conversations?connectionId=${ids[platform]}`)).items[0]!;
      check(conversation.state === "waiting",`${platform}: product question handed to a human`);
      await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_messages m JOIN app.hub_jobs j ON j.message_id=m.id WHERE m.conversation_id=$1 AND j.state='succeeded'",[conversation.id])===1,`${platform}: acknowledgement delivered once`);
      check(await queryCount("SELECT count(*) n FROM app.hub_messages WHERE conversation_id=$1 AND direction='incoming'",[conversation.id])===1,`${platform}: repeated webhook deduplicated`);
      await incoming(platform,2,"Дополнение к обращению");
      check(await queryCount("SELECT count(*) n FROM app.hub_messages WHERE conversation_id=$1 AND sender_kind='bot'",[conversation.id])===1,`${platform}: bot pauses while waiting`);
      conversation=(await request<{items:HubConversationView[]}>(`/client-hub/conversations?connectionId=${ids[platform]}`)).items[0]!;
      await request(`/client-hub/conversations/${conversation.id}/assign`,{version:conversation.version});
      const reply={clientKey:randomUUID(),body:"Здравствуйте! Менеджер АН30 на связи. Уточните VIN, проверим по каталогу."};
      const a=await request<{id:string}>(`/client-hub/conversations/${conversation.id}/replies`,reply),b=await request<{id:string}>(`/client-hub/conversations/${conversation.id}/replies`,reply);
      check(a.id === b.id,`${platform}: reply retry idempotent`);
      await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_jobs WHERE message_id=$1 AND state='succeeded'",[a.id])===1,`${platform}: operator reply completed`);
      const messages=await request<{items:HubMessageView[];conversation:HubConversationView}>(`/client-hub/conversations/${conversation.id}/messages`);
      check(messages.items.some(m=>m.id === a.id && m.senderKind === "operator" && m.state === "succeeded"),`${platform}: correct conversation history`);
      await request(`/client-hub/conversations/${conversation.id}/close`,{version:messages.conversation.version});
      await incoming(platform,3,"Еще один вопрос");
      check(await queryCount("SELECT count(*) n FROM app.hub_messages WHERE conversation_id=$1 AND sender_kind='bot'",[conversation.id])===2,`${platform}: bot resumes on a new inquiry after closing`);
    }
    await request(`/client-hub/webhooks/${ids.telegram}`,{update_id:999},401,{"x-telegram-bot-api-secret-token":"wrong"});checks++;
    // Inject a lost provider response before another revision is queued. A
    // worker restart must never turn this into an unreviewed second post.
    const faultPost=randomUUID(),publication=randomUUID(),unknownJob=randomUUID();
    await db.query("BEGIN");
    try {
      await db.query("INSERT INTO app.hub_posts(id,title,body,kind,created_by,updated_by) VALUES($1,'Проверка восстановления','Исходная версия','news',$2,$2)",[faultPost,login.userId]);
      await db.query("INSERT INTO app.hub_post_revisions(post_id,revision,title,body,created_by) VALUES($1,1,'Проверка восстановления','Исходная версия',$2)",[faultPost,login.userId]);
      await db.query("INSERT INTO app.hub_publications(id,post_id,connection_id) VALUES($1,$2,$3)",[publication,faultPost,ids.telegram]);
      await db.query("INSERT INTO app.hub_jobs(id,connection_id,publication_id,revision,state,last_error) VALUES($1,$2,$3,1,'unknown','provider_result_unknown')",[unknownJob,ids.telegram,publication]);
      await db.query("COMMIT");
    } catch(error) {await db.query("ROLLBACK");throw error;}
    await request("/client-hub/posts",{id:faultPost,revision:1,title:"Проверка восстановления",body:"Следующая версия после неизвестного результата",kind:"news",imageUrl:null});
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_publications WHERE post_id=$1 AND connection_id=ANY($2::uuid[]) AND applied_revision=2",[faultPost,[ids.vk,ids.max]])===2,"Other channels continue while one result is unknown");
    check(await queryCount("SELECT count(*) n FROM app.hub_jobs WHERE publication_id=$1 AND revision=2 AND state='queued'",[publication])===1,"Later edit waits for unknown initial publication");
    await request(`/client-hub/jobs/${unknownJob}/resolve`,{action:"bind",confirmed:true,externalId:"123456"});
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_publications WHERE id=$1 AND applied_revision=2 AND external_id='123456' AND content_kind='text'",[publication])===1,"Bound external ID reused by the queued edit");
    await request(`/client-hub/jobs/${unknownJob}/resolve`,{action:"not_published",confirmed:true},409);checks++;
    const crashMessage=randomUUID(),crashJob=randomUUID();
    const conversation=(await request<{items:HubConversationView[]}>(`/client-hub/conversations?connectionId=${ids.telegram}`)).items[0]!;
    await request(`/client-hub/conversations/${conversation.id}/assign`,{version:conversation.version});
    await db.query("INSERT INTO app.hub_messages(id,conversation_id,connection_id,direction,sender_kind,sender_user_id,body) VALUES($1,$2,$3,'outgoing','operator',$4,'Проверка прерванной отправки')",[crashMessage,conversation.id,ids.telegram,login.userId]);
    await db.query("INSERT INTO app.hub_jobs(id,connection_id,message_id,state,lease_until,claim_token) VALUES($1,$2,$3,'sending',clock_timestamp()-interval '1 second',$4)",[crashJob,ids.telegram,crashMessage,randomUUID()]);
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_jobs WHERE id=$1 AND state='unknown'",[crashJob])===1,"Expired sending lease becomes unknown, not queued");
    await request(`/client-hub/jobs/${crashJob}/resolve`,{action:"not_published",confirmed:true});
    await eventually(async()=>await queryCount("SELECT count(*) n FROM app.hub_jobs WHERE id=$1 AND state='succeeded'",[crashJob])===1,"Explicit checked retry recovers interrupted reply");
    const result=(await request<{items:HubPostView[]}>("/client-hub/posts")).items.find(p=>p.id===post.id)!;
    check(result.revision === 2 && result.jobs.some(j=>j.revision === 2),"Post journal visible through the API");
    process.stdout.write(`Client hub smoke: ${checks} checks passed. All four platforms simulated; no real messages sent.\n`);
  } finally {await db.end();}
}
main().catch((error:unknown)=>{process.stderr.write(`${error instanceof Error ? error.message:"Client hub smoke failed"}\n`);process.exitCode=1;});
