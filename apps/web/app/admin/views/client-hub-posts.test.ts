import { describe, expect, it } from "vitest";
import type { HubJobView } from "@an30/contracts";

import { postIdFromInput, publishedPostUrl, telegramPhotoChange } from "./client-hub-posts";

const telegram = { platform: "telegram" as const, publishTarget: "-1001081990249", publicUrl: "" };
const vk = { platform: "vk" as const, publishTarget: "-230001", publicUrl: "https://vk.com/an30" };

describe("a link to the published post", () => {
  it("opens a Telegram post by the channel's public name when it is saved", () => {
    expect(publishedPostUrl({ ...telegram, publicUrl: "https://t.me/AN30_news" }, "1001")).toBe("https://t.me/AN30_news/1001");
    expect(publishedPostUrl({ ...telegram, publishTarget: "@an30_news" }, "1001")).toBe("https://t.me/an30_news/1001");
  });
  it("falls back to the members-only link of a channel known by its number", () => {
    expect(publishedPostUrl(telegram, "1001")).toBe("https://t.me/c/1081990249/1001");
  });
  it("opens a VK wall post of the community", () => {
    expect(publishedPostUrl(vk, "1002")).toBe("https://vk.com/wall-230001_1002");
  });
  it("gives no link when there is nothing real to open", () => {
    expect(publishedPostUrl(telegram, null)).toBeNull();
    expect(publishedPostUrl(telegram, "test-0c5a")).toBeNull();
    expect(publishedPostUrl({ ...telegram, publishTarget: "12345" }, "7")).toBeNull();
    expect(publishedPostUrl({ ...vk, publishTarget: "" }, "1002")).toBeNull();
    expect(publishedPostUrl({ platform: "max", publishTarget: "-70000012345", publicUrl: "" }, "mid.1003")).toBeNull();
    expect(publishedPostUrl({ platform: "whatsapp", publishTarget: "АН-30", publicUrl: "" }, null)).toBeNull();
  });
});

describe("the post ID an administrator pastes", () => {
  it("accepts the number itself", () => {
    expect(postIdFromInput(telegram, " 1001 ")).toEqual({ id: "1001" });
    expect(postIdFromInput(vk, "1002")).toEqual({ id: "1002" });
  });
  it("takes the number out of a Telegram link", () => {
    const named = { ...telegram, publicUrl: "https://t.me/AN30_news" };
    expect(postIdFromInput(named, "https://t.me/an30_news/1001")).toEqual({ id: "1001" });
    expect(postIdFromInput(telegram, "https://t.me/c/1081990249/1001?single")).toEqual({ id: "1001" });
    expect(postIdFromInput(named, "t.me/s/an30_news/1001")).toEqual({ id: "1001" });
  });
  it("takes the number out of a VK link", () => {
    expect(postIdFromInput(vk, "https://vk.com/wall-230001_1002")).toEqual({ id: "1002" });
    expect(postIdFromInput(vk, "https://vk.com/an30?w=wall-230001_1002")).toEqual({ id: "1002" });
  });
  it("refuses a link to a post of another channel or community", () => {
    expect(postIdFromInput(telegram, "https://t.me/c/555/1001")).toEqual({ error: "other_channel" });
    expect(postIdFromInput({ ...telegram, publishTarget: "@an30_news" }, "https://t.me/another/1001")).toEqual({ error: "other_channel" });
    expect(postIdFromInput(vk, "https://vk.com/wall-999_1002")).toEqual({ error: "other_channel" });
  });
  it("marks a link whose channel cannot be compared with the saved one", () => {
    // Saved by number only, linked by name (and the other way round): the link may be to any channel.
    expect(postIdFromInput({ ...telegram, publicUrl: "" }, "https://t.me/another/1001")).toEqual({ id: "1001", unverified: true });
    expect(postIdFromInput({ ...telegram, publishTarget: "@an30_news", publicUrl: "" }, "https://t.me/c/555/1001")).toEqual({ id: "1001", unverified: true });
    expect(postIdFromInput({ ...vk, publishTarget: "" }, "https://vk.com/wall-999_1002")).toEqual({ id: "1002", unverified: true });
    expect(postIdFromInput({ ...telegram, publicUrl: "" }, "1001")).toEqual({ id: "1001" });
  });
  it("refuses text that is neither a number nor a post link", () => {
    expect(postIdFromInput(telegram, "https://t.me/an30_news")).toEqual({ error: "unrecognized" });
    expect(postIdFromInput(vk, "пост про фильтры")).toEqual({ error: "unrecognized" });
    expect(postIdFromInput(vk, "")).toEqual({ error: "unrecognized" });
  });
  it("keeps a MAX message ID as it is written", () => {
    expect(postIdFromInput({ platform: "max", publishTarget: "-70000012345", publicUrl: "" }, " mid.1003 ")).toEqual({ id: "mid.1003" });
  });
});

describe("a photo that Telegram will not let change", () => {
  const job = (overrides: Partial<HubJobView>): HubJobView => ({
    id: "1", connectionId: "c", platform: "telegram", connectionName: "Канал", state: "succeeded", revision: 1, appliedRevision: 1,
    externalId: "1001", contentKind: "text", attemptCount: 1, lastError: null, createdAt: "2026-11-22T10:00:00.000Z", ...overrides,
  });
  it("warns when a photo is added to a published text post", () => {
    expect(telegramPhotoChange([job({})], "https://an30.ru/a.png")).toBe("added");
    expect(telegramPhotoChange([job({})], null)).toBeNull();
  });
  it("warns when the photo is taken away from a published photo post", () => {
    expect(telegramPhotoChange([job({ contentKind: "image" })], null)).toBe("removed");
    expect(telegramPhotoChange([job({ contentKind: "image" })], "https://an30.ru/b.png")).toBeNull();
  });
  it("is silent while nothing is published in Telegram", () => {
    expect(telegramPhotoChange([job({ externalId: null, contentKind: null })], "https://an30.ru/a.png")).toBeNull();
    expect(telegramPhotoChange([job({ platform: "vk" })], "https://an30.ru/a.png")).toBeNull();
    expect(telegramPhotoChange([], "https://an30.ru/a.png")).toBeNull();
  });
});
