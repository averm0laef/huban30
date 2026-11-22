import { mkdtemp, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";

describe("OneCExchangeTempStorageService", () => {
  let root: string;
  let service: OneCExchangeTempStorageService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "an30-1c-exchange-"));
    service = new OneCExchangeTempStorageService(new ConfigService({ STORAGE_ROOT: root }));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("reassembles a file uploaded in several chunks, in order", async () => {
    await service.appendChunk("import_files/20260806/import.xml", Buffer.from("<Комме"));
    await service.appendChunk("import_files/20260806/import.xml", Buffer.from("рческая"));
    await service.appendChunk("import_files/20260806/import.xml", Buffer.from("Информация/>"));

    const assembled = await service.readAssembled("import_files/20260806/import.xml");
    expect(assembled.toString("utf8")).toBe("<КоммерческаяИнформация/>");
  });
  it("isolates same-named files and init cleanup between two information bases",async()=>{
    await service.appendChunk("import.xml",Buffer.from("primary"),"one_c");
    await service.appendChunk("import.xml",Buffer.from("secondary"),"one_c_secondary");
    await expect(service.readAssembled("import.xml","one_c")).resolves.toEqual(Buffer.from("primary"));
    await expect(service.readAssembled("import.xml","one_c_secondary")).resolves.toEqual(Buffer.from("secondary"));
    await service.purgeAll("one_c_secondary");
    await expect(service.readAssembled("import.xml","one_c")).resolves.toEqual(Buffer.from("primary"));
    await expect(service.readAssembled("import.xml","one_c_secondary")).rejects.toThrow();
  });

  it("preserves adjacent chunks even when their bytes are identical", async () => {
    await service.appendChunk("offers.xml", Buffer.from("AAAA"));
    await service.appendChunk("offers.xml", Buffer.from("BBBB"));
    await service.appendChunk("offers.xml", Buffer.from("BBBB"));

    const assembled = await service.readAssembled("offers.xml");
    expect(assembled.toString("utf8")).toBe("AAAABBBBBBBB");
  });

  it("does not guess that an equal chunk is a retry when the protocol supplies no offset", async () => {
    await service.appendChunk("dup.xml", Buffer.from("AA"));
    await service.appendChunk("dup.xml", Buffer.from("AA"));
    const assembled = await service.readAssembled("dup.xml");
    expect(assembled.toString("utf8")).toBe("AAAA");
  });

  it("only reads an assembled file when it fits the caller's size limit", async () => {
    await service.appendChunk("image.png", Buffer.from("hello"));
    await expect(service.readAssembled("image.png", "one_c", 4)).rejects.toThrow(RangeError);
    await expect(service.readAssembled("image.png", "one_c", 5)).resolves.toEqual(Buffer.from("hello"));
  });

  it("rejects a filename that tries to escape the storage root", async () => {
    await expect(service.appendChunk("../../etc/passwd", Buffer.from("x"))).rejects.toThrow();
    await expect(service.appendChunk("/etc/passwd", Buffer.from("x"))).rejects.toThrow();
  });

  it("purges every in-flight upload on a fresh session", async () => {
    await service.appendChunk("import.xml", Buffer.from("data"));
    await service.purgeAll();
    await expect(service.readAssembled("import.xml")).rejects.toThrow();
  });

  it("removes one assembled file without touching others", async () => {
    await service.appendChunk("import.xml", Buffer.from("a"));
    await service.appendChunk("offers.xml", Buffer.from("b"));
    await service.remove("import.xml");
    await expect(service.readAssembled("import.xml")).rejects.toThrow();
    await expect(service.readAssembled("offers.xml")).resolves.toEqual(Buffer.from("b"));
  });

  it("counts files left on disk after a restart and enforces the quota across concurrent uploads", async () => {
    await service.appendChunk("old/images.bin", Buffer.from("old"));
    await truncate(path.join(root, "one-c-exchange", "incoming", "one_c", "old/images.bin"), 4 * 1024 ** 3 - 1);
    service = new OneCExchangeTempStorageService(new ConfigService({ STORAGE_ROOT: root }));

    const results = await Promise.allSettled([
      service.appendChunk("primary-first.xml", Buffer.from("a")),
      service.appendChunk("primary-second.xml", Buffer.from("b")),
      service.appendChunk("secondary.xml", Buffer.from("c"), "one_c_secondary"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(results[1]).toMatchObject({ reason: { message: expect.stringContaining("квота") } });
    await service.remove("old/images.bin");
    await expect(service.appendChunk("primary-second.xml", Buffer.from("b"))).resolves.toBeUndefined();
  });
});
