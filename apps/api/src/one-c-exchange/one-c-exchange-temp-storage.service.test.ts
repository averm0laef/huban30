import { mkdtemp, rm } from "node:fs/promises";
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

  it("does not duplicate content when the same trailing chunk is resent", async () => {
    await service.appendChunk("offers.xml", Buffer.from("AAAA"));
    await service.appendChunk("offers.xml", Buffer.from("BBBB"));
    // 1C times out waiting for our response and resends the last chunk.
    await service.appendChunk("offers.xml", Buffer.from("BBBB"));

    const assembled = await service.readAssembled("offers.xml");
    expect(assembled.toString("utf8")).toBe("AAAABBBB");
  });

  it("appends a genuinely repeated chunk value that is not actually a resend", async () => {
    // "AA" followed by "AA" again is a legitimate distinct chunk (not a
    // retry) only when it does not exactly reproduce the current tail; here
    // it does reproduce the tail, so by design it is treated as a resend.
    // This documents the accepted trade-off: CommerceML gives the server no
    // chunk sequence number, so an exact-tail match is the only signal
    // available to tell a resend from new data that happens to repeat.
    await service.appendChunk("dup.xml", Buffer.from("AA"));
    await service.appendChunk("dup.xml", Buffer.from("AA"));
    const assembled = await service.readAssembled("dup.xml");
    expect(assembled.toString("utf8")).toBe("AA");
  });

  it("computes a stable sha256 over the assembled file", async () => {
    await service.appendChunk("checksum.xml", Buffer.from("hello"));
    const first = await service.checksum("checksum.xml");
    const second = await service.checksum("checksum.xml");
    expect(first.equals(second)).toBe(true);
    expect(first).toHaveLength(32);
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
});
