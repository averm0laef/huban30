import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DeliveryError, MessengerClient, emulatorEndpoints, messengerFromEnvironment, normalizeIncoming, parseWebhookJson, safeImageUrl, verifyWebhook, type Channel } from "./index.js";

const secret="webhook-secret-for-tests-only-123456";
const channel=(platform:Channel["platform"]):Channel=>({ platform,publishTarget:platform === "vk" ? "-42" : "@test_channel",inboxTarget:"42",
  secrets:{token:"test-inbox-token",publishingToken:"test-wall-token",webhookSecret:secret,appSecret:"test-app-secret"} });
function mockFetch(responses:unknown[]) {
  return vi.fn<typeof fetch>().mockImplementation(async()=>{
    const next=responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return Response.json(next);
  });
}

describe("signed private message ingestion",()=>{
  it("validates the actual WhatsApp bytes and rejects a changed body/signature",()=>{
    const raw=Buffer.from('{"entry":[]}'), signature=`sha256=${createHmac("sha256","test-app-secret").update(raw).digest("hex")}`;
    expect(verifyWebhook(channel("whatsapp"),raw,{"x-hub-signature-256":signature})).toBe(true);
    expect(verifyWebhook(channel("whatsapp"),Buffer.from('{"entry":[1]}'),{"x-hub-signature-256":signature})).toBe(false);
    expect(verifyWebhook(channel("whatsapp"),raw,{"x-hub-signature-256":[signature]})).toBe(false);
  });
  it.each(["telegram","max"] as const)("requires the %s secret header",platform=>{
    const header=platform === "telegram" ? "x-telegram-bot-api-secret-token" : "x-max-bot-api-secret";
    expect(verifyWebhook(channel(platform),Buffer.from("{}"),{[header]:secret})).toBe(true);
    expect(verifyWebhook(channel(platform),Buffer.from("{}"),{[header]:`${secret}x`})).toBe(false);
    expect(verifyWebhook(channel(platform),Buffer.from("{}"),{})).toBe(false);
  });
  it("pins VK callbacks to both the secret and configured community",()=>{
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({secret,group_id:42})),{})).toBe(true);
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({secret,group_id:43})),{})).toBe(false);
  });
  it("preserves int64 IDs from the raw payload instead of rounding",()=>{
    const parsed=parseWebhookJson(Buffer.from('{"message":{"chat":{"id":9223372036854775806}}}'));
    expect((parsed.message as {chat:{id:string}}).chat.id).toBe("9223372036854775806");
    expect(()=>parseWebhookJson(Buffer.alloc(512*1024+1))).toThrow("webhook_too_large");
  });
  it("normalizes a Telegram private message, ignores bot/channel messages and incomplete IDs",()=>{
    const event={update_id:8,message:{message_id:9,chat:{id:123,type:"private"},from:{first_name:"Антон"},text:"Нужен фильтр",date:1_700_000_000}};
    expect(normalizeIncoming(channel("telegram"),event)[0]).toMatchObject({eventId:"8",externalId:"123:9",peerId:"123",body:"Нужен фильтр",customerName:"Антон",edited:false});
    expect(normalizeIncoming(channel("telegram"),{...event,message:{...event.message,chat:{id:123,type:"channel"}}})).toEqual([]);
    expect(normalizeIncoming(channel("telegram"),{...event,message:{...event.message,from:{is_bot:true}}})).toEqual([]);
    expect(normalizeIncoming(channel("telegram"),{...event,message:{...event.message,message_id:undefined}})).toEqual([]);
  });
  it("keeps Telegram edits under the original message identity",()=>{
    const messages=normalizeIncoming(channel("telegram"),{update_id:10,edited_message:{message_id:9,chat:{id:123,type:"private"},text:"Исправлено"}});
    expect(messages[0]).toMatchObject({eventId:"10",externalId:"123:9",peerId:"123",edited:true});
  });
  it("keeps MAX bot_started and first private message in one conversation",()=>{
    const start=normalizeIncoming(channel("max"),{update_type:"bot_started",timestamp:1700000000000,user:{user_id:123,first_name:"Антон"}});
    const next=normalizeIncoming(channel("max"),{update_type:"message_created",timestamp:1700000001000,message:{sender:{user_id:123},recipient:{chat_type:"dialog",chat_id:456},body:{mid:"mid.1",text:"Вопрос"}}});
    expect(start[0]?.peerId).toBe("user:123");
    expect(next[0]?.peerId).toBe("user:123");
    expect(normalizeIncoming(channel("max"),{update_type:"bot_started",user:{}})).toEqual([]);
  });
  it("ignores VK group chats and outgoing echoes",()=>{
    const event={type:"message_new",event_id:"event-1",object:{message:{peer_id:123,from_id:123,conversation_message_id:4,text:"Вопрос"}}};
    expect(normalizeIncoming(channel("vk"),event)[0]).toMatchObject({externalId:"123:4",peerId:"123"});
    expect(normalizeIncoming(channel("vk"),{...event,object:{message:{...event.object.message,peer_id:2000000001}}})).toEqual([]);
    expect(normalizeIncoming(channel("vk"),{...event,object:{message:{...event.object.message,out:1}}})).toEqual([]);
  });
  it("uses WhatsApp BSUID when the customer hides their phone and filters other phone accounts",()=>{
    const event={entry:[{changes:[{value:{metadata:{phone_number_id:"42"},contacts:[{user_id:"US.abc123",profile:{name:"Антон"}}],messages:[{id:"wamid.1",from_user_id:"US.abc123",from:"79991234567",type:"text",text:{body:"Здравствуйте"},timestamp:"1700000000"}]}}]}]};
    expect(normalizeIncoming(channel("whatsapp"),event)[0]).toMatchObject({peerId:"US.abc123",externalId:"wamid.1",customerName:"Антон"});
    expect(normalizeIncoming({...channel("whatsapp"),inboxTarget:"43"},event)).toEqual([]);
  });
});

describe("provider delivery contracts",()=>{
  const post={title:"Поступление",body:"Масляные фильтры",imageUrl:null};
  it("resolves username and numeric Telegram aliases to the same channel without publishing",async()=>{
    const fetcher=mockFetch([{ok:true,result:{id:-1001234567890,type:"channel"}},{ok:true,result:{id:"-1001234567890",type:"channel"}}]),client=new MessengerClient(fetcher);
    expect(await client.canonicalPublishTarget({...channel("telegram"),publishTarget:"@AN30_AUTOPARTS"})).toBe("-1001234567890");
    expect(await client.canonicalPublishTarget({...channel("telegram"),publishTarget:"-1001234567890"})).toBe("-1001234567890");
    expect(fetcher.mock.calls.map(call=>String(call[0]).split("/").at(-1))).toEqual(["getChat","getChat"]);
    expect(fetcher.mock.calls.map(call=>JSON.parse(call[1]?.body as string).chat_id)).toEqual(["@AN30_AUTOPARTS","-1001234567890"]);
  });
  it("accepts a supergroup and canonicalizes the returned numeric string",async()=>{
    const fetcher=mockFetch([{ok:true,result:{id:"-0001001234567890",type:"supergroup"}}]);
    expect(await new MessengerClient(fetcher).canonicalPublishTarget(channel("telegram"))).toBe("-1001234567890");
  });
  it.each(["private","group",undefined])("rejects Telegram publish target type %s",async type=>{
    const fetcher=mockFetch([{ok:true,result:{id:-42,type}}]);
    await expect(new MessengerClient(fetcher).canonicalPublishTarget(channel("telegram"))).rejects.toMatchObject({code:"telegram_publish_target_not_channel",uncertain:false});
  });
  it.each([undefined,"not-a-number",42,"0","-0",-1.5,Number.MAX_SAFE_INTEGER+1,-(Number.MAX_SAFE_INTEGER+1),"-99999999999999999999","-123456789012345678901"])("rejects malformed Telegram target ID %s",async id=>{
    const fetcher=mockFetch([{ok:true,result:{id,type:"channel"}}]);
    await expect(new MessengerClient(fetcher).canonicalPublishTarget(channel("telegram"))).rejects.toMatchObject({code:"telegram_publish_target_invalid_id",uncertain:false});
  });
  it.each(["vk","max","whatsapp"] as const)("does not call or change the %s destination during Telegram preflight",async platform=>{
    const fetcher=mockFetch([]),input=channel(platform);
    expect(await new MessengerClient(fetcher).canonicalPublishTarget(input)).toBe(input.publishTarget);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("edits the saved Telegram post ID without sending a new post",async()=>{
    const fetcher=mockFetch([{ok:true,result:{message_id:77}}]);
    expect(await new MessengerClient(fetcher).publish(channel("telegram"),post,"job-1","77")).toBe("77");
    expect(fetcher.mock.calls[0]?.[0]).toContain("/editMessageText");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({message_id:"77",chat_id:"@test_channel"});
  });
  it("preserves the Telegram token delimiter in the documented request path",async()=>{
    const fetcher=mockFetch([{ok:true,result:{message_id:77}}]), telegram=channel("telegram");
    telegram.secrets.token="123456789:Fake_Test_Token_Only";
    await new MessengerClient(fetcher).publish(telegram,post,"job-1",null);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.telegram.org/bot123456789:Fake_Test_Token_Only/sendMessage");
  });
  it("uses MAX Authorization, new domain and PUT with saved message ID",async()=>{
    const fetcher=mockFetch([{success:true}]);
    expect(await new MessengerClient(fetcher).publish(channel("max"),post,"job-1","mid.7")).toBe("mid.7");
    const [url,init]=fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://platform-api2.max.ru/messages?message_id=mid.7");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({Authorization:"test-inbox-token"});
    expect(String(url)).not.toContain("test-inbox-token");
  });
  it("sends a MAX private reply to the stable originating user",async()=>{
    const fetcher=mockFetch([{message:{body:{mid:"mid.reply"}}}]);
    expect(await new MessengerClient(fetcher).reply(channel("max"),"user:123","Ответ","job-1")).toBe("mid.reply");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("user_id=123");
  });
  it("uploads a VK photo and uses the returned owner instead of treating its URL as an attachment",async()=>{
    const fetcher=mockFetch([{response:{upload_url:"https://pu.vk.com/upload"}},{server:9,photo:'[{"id":7}]',hash:"hash"},{response:[{owner_id:-42,id:7}]},{response:{post_id:88}}]);
    const loader=vi.fn().mockResolvedValue({bytes:new Uint8Array([137,80,78,71]),mime:"image/png",filename:"post.png"});
    expect(await new MessengerClient(fetcher,"v26.0",loader).publish(channel("vk"),{...post,imageUrl:"https://images.example.com/photo.png"},"stable-job-id",null)).toBe("88");
    expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(["https://api.vk.com/method/photos.getWallUploadServer","https://pu.vk.com/upload","https://api.vk.com/method/photos.saveWallPhoto","https://api.vk.com/method/wall.post"]);
    const uploadInit=fetcher.mock.calls[1]?.[1];
    expect(uploadInit?.headers).toBeUndefined();
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    const wallBody=fetcher.mock.calls[3]?.[1]?.body as URLSearchParams;
    expect(wallBody.get("attachments")).toBe("photo-42_7");
    expect(wallBody.get("access_token")).toBe("test-wall-token");
    expect(wallBody.get("guid")).toBe("stable-job-id");
  });
  it("does not attempt wall.post after a failed upload and reports a known unpublished result",async()=>{
    const fetcher=mockFetch([{response:{upload_url:"https://pu.vk.com/upload"}},new Error("network secret detail")]);
    const loader=vi.fn().mockResolvedValue({bytes:new Uint8Array([137]),mime:"image/png",filename:"post.png"});
    await expect(new MessengerClient(fetcher,"v26.0",loader).publish(channel("vk"),{...post,imageUrl:"https://images.example.com/a.png"},"job-1",null)).rejects.toMatchObject({code:"vk_photo_preparation_failed",uncertain:false});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects a provider upload URL outside VK before sending the image",async()=>{
    const fetcher=mockFetch([{response:{upload_url:"https://evil.example.com/upload"}}]);
    const loader=vi.fn().mockResolvedValue({bytes:new Uint8Array([137]),mime:"image/png",filename:"post.png"});
    await expect(new MessengerClient(fetcher,"v26.0",loader).publish(channel("vk"),{...post,imageUrl:"https://images.example.com/a.png"},"job-1",null)).rejects.toMatchObject({code:"invalid_vk_upload_server",uncertain:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves VK reply idempotency and uses the community token",async()=>{
    const fetcher=mockFetch([{response:19},{response:19}]), client=new MessengerClient(fetcher);
    await client.reply(channel("vk"),"123","Ответ","stable-job");
    await client.reply(channel("vk"),"123","Ответ","stable-job");
    const bodies=fetcher.mock.calls.map(call=>call[1]?.body as URLSearchParams);
    expect(bodies[0]?.get("random_id")).toBe(bodies[1]?.get("random_id"));
    expect(Number(bodies[0]?.get("random_id"))).toBeGreaterThan(0);
    expect(bodies[0]?.get("access_token")).toBe("test-inbox-token");
  });
  it("uses recipient for WhatsApp BSUID and to for a phone number",async()=>{
    const fetcher=mockFetch([{messages:[{id:"wamid.1"}]},{messages:[{id:"wamid.2"}]}]), client=new MessengerClient(fetcher);
    await client.reply(channel("whatsapp"),"US.abc123","Ответ","job-1");
    await client.reply(channel("whatsapp"),"79991234567","Ответ","job-2");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({recipient:"US.abc123"});
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toMatchObject({to:"79991234567"});
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v26.0/42/messages");
  });
  it("requires a manual task for a WhatsApp channel",async()=>{
    const fetcher=mockFetch([]);
    await expect(new MessengerClient(fetcher).publish(channel("whatsapp"),post,"job-1",null)).rejects.toMatchObject({code:"manual_channel_publication",uncertain:false});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not convert a network timeout to a safe automatic resend or expose upstream secrets",async()=>{
    const fetcher=mockFetch([new Error("URL contains secret-token")]);
    const failure=await new MessengerClient(fetcher).publish(channel("telegram"),post,"job-1",null).catch(e=>e as DeliveryError);
    expect(failure).toMatchObject({code:"provider_result_unknown",uncertain:true,retryAfter:0});
    expect(String(failure)).not.toContain("secret-token");
  });
  it("treats 5xx and incomplete successes as unknown, explicit rate limits as retryable",async()=>{
    const fetcher=mockFetch([Response.json({error:"server"},{status:503}),{ok:true,result:{}},{ok:false,error_code:429,parameters:{retry_after:45}}]), client=new MessengerClient(fetcher);
    await expect(client.publish(channel("telegram"),post,"job-1",null)).rejects.toMatchObject({uncertain:true});
    await expect(client.publish(channel("telegram"),post,"job-1",null)).rejects.toMatchObject({uncertain:true});
    await expect(client.publish(channel("telegram"),post,"job-1",null)).rejects.toMatchObject({uncertain:false,retryAfter:45});
  });
  it("does not claim a VK edit succeeded after an incomplete response",async()=>{
    const fetcher=mockFetch([{}]);
    await expect(new MessengerClient(fetcher).publish(channel("vk"),post,"job-1","88")).rejects.toMatchObject({uncertain:true});
  });
  it("accepts Telegram's unchanged edit result without making a new post",async()=>{
    const fetcher=mockFetch([{ok:false,error_code:400,description:"Bad Request: message is not modified"}]);
    expect(await new MessengerClient(fetcher).publish(channel("telegram"),post,"job-1","77")).toBe("77");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a different webhook without explicit confirmation",async()=>{
    const fetcher=mockFetch([{ok:true,result:{url:"https://existing.example.com/hook"}}]);
    await expect(new MessengerClient(fetcher).configureWebhook(channel("telegram"),"https://new.example.com/hook",false)).rejects.toMatchObject({code:"existing_webhook_requires_confirmation"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["http://images.example.com/a.png","https://127.0.0.1/a.png","https://images.local/a.png","https://user:pass@images.example.com/a.png","https://images.example.com:8443/a.png"])("rejects unsafe image URL %s",url=>expect(safeImageUrl(url)).toBe(false));
});

describe("contracts checked against official API docs",()=>{
  const post={title:"Поступление",body:"Фильтры <MANN> & свечи",imageUrl:null};
  it("treats VK wall.edit {response:{post_id}} (vk-api-schema wall_edit_response) as success",async()=>{
    const fetcher=mockFetch([{response:{post_id:88}}]);
    expect(await new MessengerClient(fetcher).publish(channel("vk"),post,"job-2","88")).toBe("88");
    const body=fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.vk.com/method/wall.edit");
    expect(body.get("post_id")).toBe("88");expect(body.get("owner_id")).toBe("-42");
  });
  it("does not accept a VK edit result for another post",async()=>{
    await expect(new MessengerClient(mockFetch([{response:{post_id:89}}])).publish(channel("vk"),post,"job-2","88")).rejects.toMatchObject({uncertain:true});
  });
  it("accepts a VK address confirmation without secret only for the configured community",()=>{
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({type:"confirmation",group_id:42})),{})).toBe(true);
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({type:"confirmation",group_id:43})),{})).toBe(false);
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({type:"confirmation",group_id:42,secret:"wrong"})),{})).toBe(false);
    expect(verifyWebhook(channel("vk"),Buffer.from(JSON.stringify({type:"message_new",group_id:42})),{})).toBe(false);
  });
  it("bolds the Telegram title with entities, so < > & in the text are never parsed",async()=>{
    const fetcher=mockFetch([{ok:true,result:{message_id:5}},{ok:true,result:{message_id:6}},{ok:true,result:{message_id:6}}]),client=new MessengerClient(fetcher);
    await client.publish(channel("telegram"),post,"job-1",null);
    await client.publish(channel("telegram"),{...post,imageUrl:"https://images.example.com/a.png"},"job-2",null);
    await client.publish(channel("telegram"),{...post,imageUrl:"https://images.example.com/b.png"},"job-3","6");
    const [text,photo,edit]=fetcher.mock.calls.map(call=>JSON.parse(call[1]?.body as string));
    const entities=[{type:"bold",offset:0,length:post.title.length}];
    expect(text).toMatchObject({text:`${post.title}\n\n${post.body}`,entities});expect(text.parse_mode).toBeUndefined();
    expect(photo).toMatchObject({photo:"https://images.example.com/a.png",caption_entities:entities});
    expect(edit.media).toMatchObject({type:"photo",media:"https://images.example.com/b.png",caption_entities:entities});
  });
  it("marks only idempotent uncertain sends as safe to repeat",async()=>{
    const lost=()=>mockFetch([new Error("socket hang up")]);
    await expect(new MessengerClient(lost()).publish(channel("telegram"),post,"job",null)).rejects.toMatchObject({uncertain:true,repeatable:false});
    await expect(new MessengerClient(lost()).publish(channel("max"),post,"job",null)).rejects.toMatchObject({uncertain:true,repeatable:false});
    await expect(new MessengerClient(lost()).publish(channel("telegram"),post,"job","77")).rejects.toMatchObject({uncertain:true,repeatable:true});
    await expect(new MessengerClient(lost()).publish(channel("max"),post,"job","mid.1")).rejects.toMatchObject({uncertain:true,repeatable:true});
    await expect(new MessengerClient(lost()).publish(channel("vk"),post,"job",null)).rejects.toMatchObject({uncertain:true,repeatable:true});
    await expect(new MessengerClient(lost()).reply(channel("vk"),"123","Ответ","job")).rejects.toMatchObject({uncertain:true,repeatable:true});
    await expect(new MessengerClient(lost()).reply(channel("telegram"),"123","Ответ","job")).rejects.toMatchObject({uncertain:true,repeatable:false});
    await expect(new MessengerClient(lost()).reply(channel("max"),"user:1","Ответ","job")).rejects.toMatchObject({uncertain:true,repeatable:false});
  });
  it("retries MAX attachment.not.ready returned with HTTP 200",async()=>{
    const fetcher=mockFetch([{code:"attachment.not.ready",message:"Key: errors.process.attachment.file.not.processed"}]);
    await expect(new MessengerClient(fetcher).publish(channel("max"),{...post,imageUrl:"https://images.example.com/a.png"},"job",null)).rejects.toMatchObject({code:"provider_rejected_attachment_not_ready",uncertain:false,retryAfter:10});
  });
  it("replaces a foreign MAX subscription only with consent, via DELETE /subscriptions?url",async()=>{
    const subscribed={subscriptions:[{url:"https://other.example/hook"}]};
    await expect(new MessengerClient(mockFetch([subscribed])).configureWebhook(channel("max"),"https://an30.example/api/v1/client-hub/webhooks/1",false)).rejects.toMatchObject({code:"existing_webhook_requires_confirmation"});
    const fetcher=mockFetch([subscribed,{success:true},{success:true}]);
    await new MessengerClient(fetcher).configureWebhook(channel("max"),"https://an30.example/api/v1/client-hub/webhooks/1",true);
    expect(fetcher.mock.calls.map(call=>`${call[1]?.method} ${String(call[0])}`)).toEqual([
      "GET https://platform-api2.max.ru/subscriptions?","DELETE https://platform-api2.max.ru/subscriptions?url=https%3A%2F%2Fother.example%2Fhook","POST https://platform-api2.max.ru/subscriptions?"]);
    expect(JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string)).toMatchObject({secret,update_types:["message_created","message_edited","bot_started","bot_added"]});
  });
  it("rejects a MAX webhook address with a port (only 443 is supported)",async()=>{
    await expect(new MessengerClient(mockFetch([])).configureWebhook(channel("max"),"https://an30.example:8443/hook",false)).rejects.toMatchObject({code:"max_webhook_port_not_supported"});
  });
  it("joins MAX first and last names",()=>{
    const [message]=normalizeIncoming(channel("max"),{update_type:"message_created",timestamp:1,message:{sender:{user_id:5,first_name:"Мария",last_name:"С."},recipient:{chat_type:"dialog",chat_id:6},body:{mid:"m",text:"x"}}});
    expect(message?.customerName).toBe("Мария С.");
  });
  it("finds the account behind a token for MAX and VK",async()=>{
    expect(await new MessengerClient(mockFetch([{user_id:8000001,first_name:"Bot"}])).accountId(channel("max"))).toBe("8000001");
    const fetcher=mockFetch([{response:{groups:[{id:229912345,name:"АН30"}],profiles:[]}}]);
    expect(await new MessengerClient(fetcher).accountId(channel("vk"))).toBe("229912345");
    expect((fetcher.mock.calls[0]?.[1]?.body as URLSearchParams).get("access_token")).toBe("test-inbox-token");
  });
  it("diagnoses VK rights from the documented bit mask without publishing",async()=>{
    const fetcher=mockFetch([{response:{groups:[{id:42,name:"АН30"}]}},{response:8192}]);
    const result=await new MessengerClient(fetcher).diagnose(channel("vk"),{publish:true,inbox:true});
    expect(result.checks).toEqual([{name:"Ключ сообщества",ok:true,detail:"Ключ сообщества «АН30» (ID 42) принят"},{name:"Токен для публикаций",ok:false,detail:"vk_photos_permission_missing"}]);
    expect(fetcher.mock.calls.map(call=>String(call[0]).split("/").at(-1))).toEqual(["groups.getById","account.getAppPermissions"]);
  });
  it("reports a Telegram bot whose messages go to another address",async()=>{
    const fetcher=mockFetch([{ok:true,result:{id:1,username:"an30_bot"}},{ok:true,result:{status:"administrator",can_post_messages:true,can_edit_messages:true}},{ok:true,result:{url:"https://other.example/hook"}}]);
    const result=await new MessengerClient(fetcher).diagnose(channel("telegram"),{webhookUrl:"https://an30.example/hook",publish:true,inbox:true});
    expect(result.checks.map(check=>[check.ok,check.detail])).toEqual([[true,"Бот @an30_bot найден"],[true,"Бот — администратор канала: может публиковать и редактировать"],[false,"webhook_points_elsewhere"]]);
  });
  it("routes every provider to a loopback emulator and refuses it in production",async()=>{
    expect(()=>emulatorEndpoints("https://api.telegram.org")).toThrow();
    expect(()=>emulatorEndpoints("http://10.0.0.5:4901")).toThrow();
    expect(()=>messengerFromEnvironment({HUB_PROVIDER_EMULATOR_URL:"http://127.0.0.1:4901"},"production")).toThrow();
    expect(messengerFromEnvironment({},"production").emulated).toBe(false);
    const endpoints=emulatorEndpoints("http://127.0.0.1:4901");
    const fetcher=mockFetch([{ok:true,result:{message_id:1}}]);
    await new MessengerClient(fetcher,"v26.0",undefined,endpoints).publish(channel("telegram"),post,"job",null);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://127.0.0.1:4901/telegram/bottest-inbox-token/sendMessage");
    expect(endpoints.vkUpload(new URL("http://127.0.0.1:4901/vk-upload/x"))).toBe(true);
    expect(endpoints.vkUpload(new URL("https://pu.vk.com/upload"))).toBe(false);
  });
});
