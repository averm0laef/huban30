import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { CatalogEnrichmentQuerySchema, type CatalogEnrichmentResponse, type CatalogEnrichmentQuery } from "@an30/contracts";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { AuditService } from "../security/audit.service.js";
import type { AuthContext } from "../auth/auth-context.js";
import { normalizeArticleNumber, normalizeBrand } from "./catalog-search-normalize.js";
import { reefParts, ReefPartSchema } from "./reef-part-normalize.js";

const CACHE_SECONDS = 6*60*60;
const BUDGET = `local used=tonumber(redis.call('GET',KEYS[1]) or '0'); if used+tonumber(ARGV[1])>tonumber(ARGV[2]) then return 0 end;
  redis.call('INCRBY',KEYS[1],ARGV[1]); redis.call('EXPIRE',KEYS[1],172800); return 1`;
const UNLOCK = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0`;
const CachedSchema=z.object({ parts:z.array(ReefPartSchema).max(20),checkedAt:z.iso.datetime() }).strict();
type Cache = z.infer<typeof CachedSchema>;
function result(status:CatalogEnrichmentResponse["status"],message:string):CatalogEnrichmentResponse { return {status,message,candidates:[],checkedAt:null}; }

@Injectable()
export class CatalogEnrichmentService {
  private readonly inFlight = new Map<string,Promise<Cache|null>>();
  constructor(private readonly config:ConfigService,private readonly db:DatabaseService,private readonly redis:RedisService,
    private readonly limits:RateLimitService,private readonly audit:AuditService) {}
  status() {
    return { enabled:this.config.get<boolean>("REEFAPI_ENABLED") === true,
      configured:!!this.config.get<string>("REEFAPI_KEY"),
      dailyCreditLimit:this.config.get<number>("REEFAPI_DAILY_CREDITS") ?? 30 };
  }
  async match(input:unknown,actor:AuthContext):Promise<CatalogEnrichmentResponse> {
    const parsed=CatalogEnrichmentQuerySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("Укажите артикул производителя и бренд");
    const request=parsed.data;
    if (!this.status().enabled) return result("disabled","Внешнее сопоставление отключено. Поиск по каталогу 1С работает.");
    await this.limits.consume("catalog-enrichment-user",actor.userId,10,60);
    const normalizedArticle=normalizeArticleNumber(request.article),normalizedBrand=normalizeBrand(request.brand);
    if (normalizedArticle.length<3 || !normalizedBrand) throw new BadRequestException("Проверьте артикул и бренд");
    const key=`an30:enrichment:v1:${createHash("sha256").update(JSON.stringify([request.mode,normalizedArticle,this.config.get("REEFAPI_MARKET") ?? "de"])).digest("hex")}`;
    let cached:Cache|null;
    try {
      await this.redis.ensureConnected();
      const text=await this.redis.client.get(key);
      const stored=text ? CachedSchema.safeParse(JSON.parse(text)):null;
      if (stored?.success) cached=stored.data;
      else {
        let pending=this.inFlight.get(key);
        if (!pending) {
          pending=this.fetchParts(request,key);
          this.inFlight.set(key,pending);
          void pending.finally(()=>this.inFlight.delete(key)).catch(()=>undefined);
        }
        cached=await pending;
      }
    } catch { return result("unavailable","Внешний справочник временно недоступен. Используйте каталог 1С или уточните деталь у менеджера."); }
    if (!cached) return result("limited","Сейчас запрос недоступен: действует ограничение обращений к справочнику. Повторите позже.");
    if (!cached.parts.length) return { ...result("not_found","Точных данных по запросу не найдено. Это не означает, что детали нет в каталоге 1С."),checkedAt:cached.checkedAt };
    const pairs=cached.parts.map(part=>({ article:normalizeArticleNumber(part.article),brand:normalizeBrand(part.brand) }));
    const rows=(await this.db.query<{ id:string;sku:string;name:string;brand:string;is_active:boolean;article_key:string;brand_key:string }>(`WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(article text,brand text))
      SELECT p.id,p.sku::text,p.name,b.name AS brand,p.is_active,p.sku_normalized AS article_key,app.normalize_brand(b.name) AS brand_key
      FROM app.products p JOIN app.brands b ON b.id=p.brand_id JOIN requested r ON r.article=p.sku_normalized AND r.brand=app.normalize_brand(b.name)
      WHERE p.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY p.is_active DESC,p.id LIMIT 200`,[JSON.stringify(pairs)])).rows;
    await this.audit.record({ action:"catalog.enrichment.checked",actorUserId:actor.userId,actorRole:actor.role,entityType:"catalog_enrichment",
      metadata:{mode:request.mode,candidateCount:cached.parts.length,matchedCount:rows.length} });
    return {status:"ok",message:"Сопоставление проверяет только совпадение артикула и бренда. Совместимость, цену и остаток подтвердите по 1С и данным автомобиля.",checkedAt:cached.checkedAt,
      candidates:cached.parts.map(part=>({ ...part,
        matchesRequestedIdentity:normalizeArticleNumber(part.article)===normalizedArticle && normalizeBrand(part.brand)===normalizedBrand,
        localProducts:rows.filter(row=>row.article_key===normalizeArticleNumber(part.article) && row.brand_key===normalizeBrand(part.brand)).slice(0,10)
          .map(row=>({id:row.id,sku:row.sku,name:row.name,brand:row.brand,isActive:row.is_active})),
      })) };
  }
  private async fetchParts(request:CatalogEnrichmentQuery,key:string):Promise<Cache|null> {
    const token=randomUUID(), lock="an30:enrichment:outbound-lock";
    // One live lookup per deployment protects credits and bounds concurrent cold starts.
    if (await this.redis.client.set(lock,token,"PX",25_000,"NX") !== "OK") return null;
    try {
      const cost=request.mode === "oe" ? 3:2;
      const budgetKey=`an30:enrichment:budget:${new Date().toISOString().slice(0,10)}`;
      if (Number(await this.redis.client.eval(BUDGET,1,budgetKey,cost,this.config.get<number>("REEFAPI_DAILY_CREDITS") ?? 30)) !== 1) return null;
      const response=await fetch(`https://api.reefapi.com/autodoc/v1/${request.mode === "oe" ? "oem_lookup":"part_search"}`,{
        method:"POST",headers:{"content-type":"application/json","x-api-key":this.config.getOrThrow<string>("REEFAPI_KEY")},
        body:JSON.stringify({[request.mode === "oe" ? "oem_number":"query"]:request.article,market:this.config.get<string>("REEFAPI_MARKET") ?? "de",max_results:20}),
        redirect:"error",signal:AbortSignal.timeout(20_000),
      });
      let length=0;const chunks:Uint8Array[]=[];
      if (!response.body) throw new Error("empty_response");
      const reader=response.body.getReader();
      for (;;) { const chunk=await reader.read();if(chunk.done) break;length+=chunk.value.byteLength;
        if(length>2*1024*1024) {await reader.cancel();throw new Error("response_too_large");} chunks.push(chunk.value); }
      const payload=JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>;
      if (!response.ok || payload.ok !== true) {
        const error=payload.error && typeof payload.error === "object" ? payload.error as Record<string,unknown>:{};
        if(error.code === "NOT_FOUND") {const empty={parts:[],checkedAt:new Date().toISOString()};await this.redis.client.set(key,JSON.stringify(empty),"EX",900);return empty;}
        throw new Error("lookup_failed");
      }
      const data=payload.data && typeof payload.data === "object" ? payload.data as Record<string,unknown>:{};
      if(!Array.isArray(data.parts)) throw new Error("response_shape_changed");
      const parts=reefParts(payload);
      if(data.parts.length && !parts.length) throw new Error("response_shape_changed");
      const value={parts,checkedAt:new Date().toISOString()};
      await this.redis.client.set(key,JSON.stringify(value),"EX",CACHE_SECONDS);
      return value;
    } finally { await this.redis.client.eval(UNLOCK,1,lock,token); }
  }
}
