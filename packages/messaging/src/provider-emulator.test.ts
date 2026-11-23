import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeliveryError, messengerFromEnvironment, type Channel, type MessengerClient } from "./index.js";

interface EmulatorState {
  telegram: { posts: Record<string, { id: string; kind: string; text: string; photo: string | null; edits: number }> };
  max: { posts: Record<string, { id: string; text: string; image: string | null; edits: number }> };
  vk: { posts: Record<string, { id: string; text: string; attachments: string; edits: number }> };
}
interface Emulator { server: Server; state: () => EmulatorState; reset: () => void }

// The emulator is the one developers run by hand (scripts/client-hub-checks); here the real client talks to it
// over HTTP, so a change on either side that breaks posting is caught without the real platforms.
const emulatorFile = new URL("../../../scripts/client-hub-checks/provider-emulator.mjs", import.meta.url).href;
const channels: Record<"telegram" | "max" | "vk", Channel> = {
  telegram: { platform: "telegram", publishTarget: "-1001081990249", inboxTarget: "", secrets: { token: "100200300:emulator-only" } },
  max: { platform: "max", publishTarget: "-70000000000001", inboxTarget: "", secrets: { token: "emulator-only-max" } },
  vk: { platform: "vk", publishTarget: "-230001", inboxTarget: "", secrets: { token: "emulator-only-community", publishingToken: "emulator-only-wall" } },
};
const platforms = ["telegram", "max", "vk"] as const;
const text = { title: "Новое поступление", body: "Фильтры уже на складе.", imageUrl: null };
const photo = { ...text, imageUrl: "https://an30.ru/media/filters.png" };

let emulator: Emulator, base: string, client: MessengerClient;
const fault = async (platform: string, method: string, mode: "reject" | "error500" | "drop") => {
  const response = await fetch(`${base}/_emulator/fault`, { method: "POST", body: JSON.stringify({ platform, method, mode }) });
  expect(response.status).toBe(200);
};
const failure = (work: Promise<unknown>) => work.then(() => { throw new Error("The publication was expected to fail"); }, (error: unknown) => {
  if (!(error instanceof DeliveryError)) throw error;
  return { code: error.code, uncertain: error.uncertain, repeatable: error.repeatable };
});

beforeAll(async () => {
  emulator = ((await import(emulatorFile)) as { createEmulator: () => Emulator }).createEmulator();
  await new Promise<void>(resolve => emulator.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(emulator.server.address() as AddressInfo).port}`;
  client = messengerFromEnvironment({ HUB_PROVIDER_EMULATOR_URL: base }, "development").client;
});
afterAll(() => new Promise<void>(resolve => { emulator.server.close(() => resolve()); emulator.server.closeAllConnections(); }));
beforeEach(() => emulator.reset());

describe("posting through the local provider emulator", () => {
  it.each(platforms)("%s: an edited post replaces the published one instead of adding a second", async platform => {
    const id = await client.publish(channels[platform], text, "key-1", null);
    expect(await client.publish(channels[platform], { ...text, body: "Исправленный текст." }, "key-2", id)).toBe(id);
    const posts = Object.values(emulator.state()[platform].posts);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id, text: "Новое поступление\n\nИсправленный текст.", edits: 1 });
  });

  it.each(platforms)("%s: a photo post is published with its image and the image can be replaced", async platform => {
    const id = await client.publish(channels[platform], photo, "key-1", null);
    expect(await client.publish(channels[platform], { ...photo, imageUrl: "https://an30.ru/media/filters-2.png" }, "key-2", id)).toBe(id);
    const state = emulator.state();
    expect(Object.values(state[platform].posts)).toHaveLength(1);
    if (platform === "telegram") expect(state.telegram.posts[`${channels.telegram.publishTarget}:${id}`]).toMatchObject({ kind: "photo", photo: "https://an30.ru/media/filters-2.png", edits: 1 });
    if (platform === "max") expect(state.max.posts[id]).toMatchObject({ image: "https://an30.ru/media/filters-2.png", edits: 1 });
    // VK receives the picture as an uploaded photo, never as a link.
    if (platform === "vk") expect(state.vk.posts[`${channels.vk.publishTarget}_${id}`]!.attachments).toMatch(/^photo-230001_\d+$/u);
  });

  it("Telegram refuses to add a photo to a text post or take it from a photo post, and keeps the post as it was", async () => {
    const plain = await client.publish(channels.telegram, text, "key-1", null);
    expect(await failure(client.publish(channels.telegram, photo, "key-2", plain))).toMatchObject({ code: "provider_rejected_400", uncertain: false });
    const withPhoto = await client.publish(channels.telegram, photo, "key-3", null);
    expect(await failure(client.publish(channels.telegram, text, "key-4", withPhoto))).toMatchObject({ code: "provider_rejected_400", uncertain: false });
    const posts = emulator.state().telegram.posts;
    expect(posts[`${channels.telegram.publishTarget}:${plain}`]).toMatchObject({ kind: "text", photo: null, edits: 0 });
    expect(posts[`${channels.telegram.publishTarget}:${withPhoto}`]).toMatchObject({ kind: "photo", edits: 0 });
  });

  it("Telegram: saving the same text again is not an error", async () => {
    const id = await client.publish(channels.telegram, text, "key-1", null);
    expect(await client.publish(channels.telegram, text, "key-2", id)).toBe(id);
    expect(Object.values(emulator.state().telegram.posts)[0]!.edits).toBe(0);
  });

  it("a refusal is a definite failure and nothing is published", async () => {
    await fault("telegram", "sendMessage", "reject");
    expect(await failure(client.publish(channels.telegram, text, "key-1", null))).toEqual({ code: "provider_rejected_403", uncertain: false, repeatable: false });
    expect(Object.values(emulator.state().telegram.posts)).toHaveLength(0);
  });

  it("a lost answer to a new post is reported as unknown: the post exists and must not be sent again blindly", async () => {
    await fault("max", "POST messages", "drop");
    expect(await failure(client.publish(channels.max, text, "key-1", null))).toEqual({ code: "provider_result_unknown", uncertain: true, repeatable: false });
    expect(Object.values(emulator.state().max.posts)).toHaveLength(1);
  });

  it("VK: a repeated send with the same key returns the same wall post", async () => {
    await fault("vk", "wall.post", "drop");
    expect(await failure(client.publish(channels.vk, text, "key-1", null))).toEqual({ code: "provider_result_unknown", uncertain: true, repeatable: true });
    const id = await client.publish(channels.vk, text, "key-1", null);
    expect(Object.values(emulator.state().vk.posts).map(post => post.id)).toEqual([id]);
  });
});
