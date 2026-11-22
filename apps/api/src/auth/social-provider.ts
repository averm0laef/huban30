import { createHash } from "node:crypto";

import { z } from "zod";

export const socialProviders = ["yandex", "vk"] as const;
export type SocialProvider = typeof socialProviders[number];

const origins = {
  yandex: "https://oauth.yandex.ru",
  vk: "https://id.vk.ru",
} as const;

const tokenSchema = z.object({
  access_token: z.string().min(1).max(8_192).regex(/^[\x21-\x7e]+$/u),
  state: z.string().optional(),
  user_id: z.union([z.string(), z.number().int()]).optional(),
});

const subjectSchema = z.union([z.string(), z.number().int()])
  .transform(String)
  .pipe(z.string().regex(/^[0-9A-Za-z_-]{1,128}$/u));

export function buildSocialAuthorizationUrl(
  provider: SocialProvider,
  clientId: string,
  redirectUri: string,
  state: string,
  verifier: string,
): string {
  const url = new URL("/authorize", origins[provider]);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: provider === "vk" ? "s256" : "S256",
    ...(provider === "yandex" ? { scope: "login:info" } : { prompt: "login" }),
  }).toString();
  return url.href;
}

async function providerJson(url: string | URL, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Identity provider returned an error");
  return response.json();
}

export async function resolveSocialSubject(input: {
  clientId: string;
  code: string;
  deviceId?: string;
  provider: SocialProvider;
  redirectUri: string;
  state: string;
  verifier: string;
}): Promise<string> {
  const { provider, clientId, code, redirectUri, state, verifier, deviceId } = input;
  const params = {
    grant_type: "authorization_code",
    client_id: clientId,
    code_verifier: verifier,
  };
  if (provider === "yandex") {
    const token = tokenSchema.parse(await providerJson(new URL("/token", origins.yandex), {
      method: "POST",
      body: new URLSearchParams({ ...params, code }),
    }));
    const profile = z.object({ id: subjectSchema, client_id: z.string() }).parse(await providerJson(
      "https://login.yandex.ru/info?format=json",
      { headers: { Authorization: `OAuth ${token.access_token}` } },
    ));
    if (profile.client_id !== clientId) throw new Error("Identity provider returned an unexpected client");
    return profile.id;
  }

  if (!deviceId) throw new Error("Missing VK ID device identifier");
  const tokenUrl = new URL("/oauth2/auth", origins.vk);
  tokenUrl.search = new URLSearchParams({
    ...params, redirect_uri: redirectUri, state, device_id: deviceId,
  }).toString();
  const token = tokenSchema.parse(await providerJson(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({ code }),
  }));
  if (token.state !== state) throw new Error("Identity provider state mismatch");
  const profileUrl = new URL("/oauth2/user_info", origins.vk);
  profileUrl.searchParams.set("client_id", clientId);
  const profile = z.object({ user: z.object({ user_id: subjectSchema }) }).parse(await providerJson(profileUrl, {
    method: "POST",
    body: new URLSearchParams({ access_token: token.access_token }),
  }));
  if (subjectSchema.parse(token.user_id) !== profile.user.user_id) throw new Error("Identity provider subject mismatch");
  return profile.user.user_id;
}
