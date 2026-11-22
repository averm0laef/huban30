import { describe,expect,it } from "vitest";
import type { OneCCatalogRow } from "@an30/contracts";
import { namespaceOneCRow,sourceExternalId,sourceFromPath,sourceSql } from "./one-c-source.js";
describe("two 1C source identities",()=>{
  it("preserves existing primary IDs and gives the secondary stable, bounded independent IDs",()=>{
    expect(sourceExternalId("one_c","product-1")).toBe("product-1");
    const secondary=sourceExternalId("one_c_secondary","product-1");
    expect(secondary).toMatch(/^1c-secondary:[a-f0-9]{64}$/u);
    expect(secondary).toBe(sourceExternalId("one_c_secondary","product-1"));
    expect(secondary).not.toBe(sourceExternalId("one_c_secondary","other-product"));
  });
  it("rewrites parent/category/product/warehouse references consistently",()=>{
    const category={entityType:"category",externalId:"cat-1",parentExternalId:"parent",name:"Фильтры",slug:"filters",description:null,sortOrder:0,isActive:true,version:1} as const;
    const rewritten=namespaceOneCRow("one_c_secondary",category);
    expect(rewritten).toMatchObject({externalId:sourceExternalId("one_c_secondary","cat-1"),parentExternalId:sourceExternalId("one_c_secondary","parent")});
    expect(namespaceOneCRow("one_c",category)).toBe(category);
    const stock:OneCCatalogRow={entityType:"stock",productExternalId:"product-1",warehouseExternalId:"warehouse",quantityOnHand:10,version:1};
    expect(namespaceOneCRow("one_c_secondary",stock)).toMatchObject({productExternalId:sourceExternalId("one_c_secondary","product-1"),warehouseExternalId:sourceExternalId("one_c_secondary","warehouse"),quantityOnHand:10});
  });
  it("selects only the two known routes and rejects arbitrary source SQL",()=>{
    expect(sourceFromPath("/api/v1/integrations/1c/exchange?type=catalog")).toBe("one_c");
    expect(sourceFromPath("/api/v1/integrations/1c/exchange/secondary?type=catalog")).toBe("one_c_secondary");
    expect(()=>sourceSql("';DROP TABLE x;--" as never)).toThrow();
  });
});
