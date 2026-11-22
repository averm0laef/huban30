import type { OneCCatalogRow } from "@an30/contracts";
import { createHash } from "node:crypto";
import { buildSlug, shortId } from "./one-c-exchange-slug.js";
// Same literal as commerce-ml.parser.ts's EXCHANGE_WAREHOUSE_EXTERNAL_ID; not
// imported to keep this module free of the parser's dependencies.
const EXCHANGE_WAREHOUSE_EXTERNAL_ID = "1c-default-warehouse";

export const ONE_C_SOURCES = ["one_c", "one_c_secondary"] as const;
export type OneCSource = typeof ONE_C_SOURCES[number];
export function sourceFromPath(url: string): OneCSource {
  return url.split("?")[0]?.endsWith("/exchange/secondary") ? "one_c_secondary" : "one_c";
}
/** Closed enum, never an interpolation of arbitrary request text. */
export function sourceSql(source: OneCSource): "'one_c'" | "'one_c_secondary'" {
  if(source === "one_c") return "'one_c'";
  if(source === "one_c_secondary") return "'one_c_secondary'";
  throw new Error("Unknown 1C source");
}
export function sourceExternalId(source: OneCSource,id:string):string {
  sourceSql(source);
  return source === "one_c" ? id : `1c-secondary:${createHash("sha256").update(id).digest("hex")}`;
}
export function namespaceOneCRow(source: OneCSource,row: OneCCatalogRow):OneCCatalogRow {
  sourceSql(source);
  if(source === "one_c") return row;
  const id=(value:string)=>sourceExternalId(source,value);
  switch(row.entityType) {
    // Manufacturer keys are synthesized from the same canonical name by the
    // parser, never arbitrary group GUIDs. Sharing avoids duplicate facets.
    case "brand": return row;
    case "category": return {...row,externalId:id(row.externalId),parentExternalId:row.parentExternalId ? id(row.parentExternalId):null,slug:buildSlug(row.name,id(row.externalId))};
    // The synthetic flat-stock warehouse keeps its historical code/name; a
    // real 1C warehouse keeps its own name and gets a code unique to this base.
    case "warehouse": return row.externalId === EXCHANGE_WAREHOUSE_EXTERNAL_ID
      ? {...row,externalId:id(row.externalId),code:"1C-SECONDARY",name:"Склад дополнительной базы (1С)"}
      : {...row,externalId:id(row.externalId),code:`1C2-${shortId(row.externalId)}`};
    case "product": return {...row,externalId:id(row.externalId),categoryExternalId:row.categoryExternalId ? id(row.categoryExternalId):null,slug:buildSlug(row.name,id(row.externalId))};
    case "price": return {...row,productExternalId:id(row.productExternalId)};
    case "stock": return {...row,productExternalId:id(row.productExternalId),warehouseExternalId:id(row.warehouseExternalId)};
  }
}
