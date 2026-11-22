import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { AuthContext } from "../auth/auth-context.js";
import { CatalogEnrichmentService } from "./catalog-enrichment.service.js";

const actor={userId:"61f38d2e-9049-49d0-b0f9-d49119733013",role:"manager"} as AuthContext;
const input={article:"W 914/2",brand:"MANN-FILTER",mode:"part"};
describe("optional external matching",()=>{
  const query=vi.fn(),get=vi.fn(),set=vi.fn(),evalRedis=vi.fn(),consume=vi.fn(),record=vi.fn(),fetcher=vi.fn();
  let service:CatalogEnrichmentService;
  function create(enabled=true) {
    return new CatalogEnrichmentService(new ConfigService({REEFAPI_ENABLED:enabled,REEFAPI_KEY:"server-only-key",REEFAPI_MARKET:"de",REEFAPI_DAILY_CREDITS:30}),
      {query} as unknown as DatabaseService,{ensureConnected:vi.fn(),client:{get,set,eval:evalRedis}} as unknown as RedisService,
      {consume} as unknown as RateLimitService,{record} as unknown as AuditService);
  }
  beforeEach(()=>{
    vi.resetAllMocks();vi.stubGlobal("fetch",fetcher);service=create();
    get.mockResolvedValue(null);set.mockResolvedValue("OK");evalRedis.mockResolvedValue(1);query.mockResolvedValue({rows:[]});
  });
  afterEach(()=>vi.unstubAllGlobals());
  it("does not contact the network or Redis when disabled",async()=>{
    expect(await create(false).match(input,actor)).toMatchObject({status:"disabled",candidates:[]});
    expect(fetcher).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
  });
  it("rejects unbounded input before spending credits",async()=>{
    await expect(service.match({...input,article:"x".repeat(1000)},actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only an allowlisted server URL and key header and matches the exact brand/article pair",async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({ok:true,meta:{source:"secret-source"},data:{parts:[
      {article_number:"W914-2",brand:"MANN-FILTER",title:"Oil filter",price:10,url:"https://supplier.test",article_id:"private-id"},
      {article_number:"W914/2",brand:"OTHER",title:"Different part"},
    ]}})));
    query.mockResolvedValue({rows:[{id:actor.userId,sku:"W 914/2",name:"Фильтр",brand:"MANN-FILTER",is_active:true,article_key:"W9142",brand_key:"MANNFILTER"}]});
    const response=await service.match(input,actor);
    expect(response.status).toBe("ok");expect(response.candidates[0]?.localProducts).toHaveLength(1);expect(response.candidates[1]?.localProducts).toHaveLength(0);
    expect(response.candidates[0]?.matchesRequestedIdentity).toBe(true);expect(response.candidates[1]?.matchesRequestedIdentity).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/secret-source|private-id|supplier\.test|price|currency|units_left/iu);
    const [url,options]=fetcher.mock.calls[0] as [string,RequestInit];
    expect(url).toBe("https://api.reefapi.com/autodoc/v1/part_search");
    expect(options.headers).toMatchObject({"x-api-key":"server-only-key"});expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body as string)).toEqual({query:"W 914/2",market:"de",max_results:20});
    expect(query.mock.calls[0]?.[0]).toContain("r.article=p.sku_normalized AND r.brand=app.normalize_brand(b.name)");
  });
  it("reuses cached identities while resolving current 1C products on every request",async()=>{
    get.mockResolvedValue(JSON.stringify({parts:[{article:"W914/2",brand:"MANN-FILTER",name:"Oil filter"}],checkedAt:"2026-11-18T10:00:00.000Z"}));
    expect((await service.match(input,actor)).status).toBe("ok");expect(fetcher).not.toHaveBeenCalled();expect(query).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the shared budget is exhausted",async()=>{
    evalRedis.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await service.match(input,actor)).toMatchObject({status:"limited"});expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not expose provider error bodies or credentials",async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({ok:false,error:{code:"AUTH_FAILED",message:"server-only-key secret-source"}}),{status:401}));
    const response=await service.match(input,actor);
    expect(response.status).toBe("unavailable");expect(JSON.stringify(response)).not.toContain("server-only-key");
    expect(record).not.toHaveBeenCalled();
  });
  it("treats a changed provider schema as unavailable rather than claiming a part was not found",async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({ok:true,data:{unexpected:[]}})));
    expect((await service.match(input,actor)).status).toBe("unavailable");
    expect(query).not.toHaveBeenCalled();
  });
  it("uses the OE endpoint only when the operator explicitly selects an OE number",async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({ok:false,error:{code:"NOT_FOUND"}}),{status:404}));
    const response=await service.match({...input,mode:"oe"},actor);
    expect(response.status).toBe("not_found");expect(fetcher.mock.calls[0]?.[0]).toContain("/oem_lookup");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body as string)).toEqual({oem_number:"W 914/2",market:"de",max_results:20});
  });
});
