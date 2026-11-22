import { describe, expect, it } from "vitest";
import { catalogSearchIdentity, searchBrandToken } from "./catalog-search-identity.js";

describe("catalog article intent",()=>{
  it.each(["w914/2", "W 914-2", "w.914.2"])("keeps a concrete article %s out of fuzzy matching",(query)=>{
    expect(catalogSearchIdentity(query)).toEqual({ article:"W9142",brandKeys:[],articleOnly:true });
  });
  it.each(["MANN W 914/2", "W914-2 манн", "MANN-FILTER W914/2"])("requires the named brand for %s",(query)=>{
    expect(catalogSearchIdentity(query)).toEqual({ article:"W9142",brandKeys:["MANN","MANNFILTER"],articleOnly:true });
  });
  it("recognises Cyrillic brand spellings without inferring part compatibility",()=>{
    expect(catalogSearchIdentity("бош 0 242 235 668")).toEqual({ article:"0242235668",brandKeys:["BOSCH"],articleOnly:true });
    expect(searchBrandToken("бош")).toBe("bosch");
  });
  it.each(["10%", "10_20", "%%"])("does not reinterpret a literal %s as a SQL article wildcard",query=>{
    expect(catalogSearchIdentity(query).article).toBe("");
  });
  it.each(["масло 5W-30", "5w30", "фильтр масляный", "oil filter", "h7", "12v", undefined])("does not treat attributes/name %s as a concrete article",(query)=>{
    expect(catalogSearchIdentity(query).articleOnly).toBe(false);
  });
});
