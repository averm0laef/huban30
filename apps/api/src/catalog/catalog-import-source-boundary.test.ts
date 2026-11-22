import {describe,expect,it,vi} from "vitest";
import {BadRequestException} from "@nestjs/common";
import type {DatabaseService} from "../infrastructure/database.service.js";
import {CatalogImportService} from "./catalog-import.service.js";
describe("legacy primary JSON source boundary",()=>{
  it.each(["externalId","productExternalId","brandExternalId","categoryExternalId","parentExternalId","warehouseExternalId"])("rejects secondary %s before staging any batch",async field=>{
    const transaction=vi.fn();
    const service=new CatalogImportService({transaction} as unknown as DatabaseService);
    await expect(service.upload({schemaVersion:1,externalBatchId:"boundary-test",exportedAt:"2026-11-18T12:00:00Z",rows:[{[field]:"1c-secondary:reserved-identifier"}]})).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
