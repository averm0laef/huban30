// Session cookie issued by mode=checkauth (see one-c-exchange.controller.ts
// and the CommerceML protocol notes in packages/contracts/src/one-c-exchange.ts).
// 1C is not a browser: it does not manage a cookie jar, it just reads the
// name/value back out of the checkauth response body and resends them
// itself as a literal `Cookie:` header on every later request in the same
// session. Storing the token in Redis rather than in process memory means a
// mid-sync API restart or a second replica does not strand 1C's session --
// any instance behind the load balancer can verify a token any other
// instance issued.
import { randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import type { OneCSource } from "./one-c-source.js";

// 1C is expected to drive checkauth -> init -> file (many chunks) -> import
// (many polls) back to back for one export, but a 30-40k SKU catalog can
// take a while to upload and apply. Long enough to comfortably cover that,
// short enough that an abandoned session does not linger forever.
const SESSION_TTL_SECONDS = 2 * 60 * 60;

interface ExchangeSession {
  source?: OneCSource;
  authRevision: string;
  expiresAt: number;
  ipAddress: string;
}

@Injectable()
export class OneCExchangeSessionService {
  readonly cookieName = "an30_1c_exchange";

  constructor(
    private readonly redis: RedisService,
    private readonly integration: OneCIntegrationService,
  ) {}

  async issue(ipAddress: string, authRevision: string, source: OneCSource = "one_c"): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.redis.ensureConnected();
    // Bind the opaque cookie to the source address that passed the CIDR
    // allowlist during checkauth. Otherwise a copied token would bypass the
    // integration's IP restriction for its full two-hour lifetime.
    const session: ExchangeSession = {
      source,
      authRevision,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1_000,
      ipAddress,
    };
    await this.redis.client.set(this.key(token), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
    return token;
  }

  /** Absolute expiry cannot be extended by requests; settings changes revoke existing sessions. */
  async verify(token: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<boolean> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return false;
    await this.redis.ensureConnected();
    const stored = await this.redis.client.get(this.key(token));
    if (!stored) return false;
    let session: ExchangeSession;
    try {
      session = JSON.parse(stored) as ExchangeSession;
      if (!session || typeof session.authRevision !== "string" || !/^\d+$/u.test(session.authRevision)
        || typeof session.ipAddress !== "string" || !Number.isSafeInteger(session.expiresAt)) {
        throw new Error("Invalid exchange session");
      }
    } catch {
      // Tokens issued before revision binding are deliberately invalidated on upgrade.
      await this.redis.client.del(this.key(token));
      return false;
    }
    if (session.ipAddress !== ipAddress) return false;
    if ((session.source ?? "one_c") !== source) return false;
    const currentRevision = source === "one_c" ? await this.integration.currentExchangeSessionRevision(ipAddress)
      : await this.integration.currentExchangeSessionRevision(ipAddress,source);
    if (Date.now() >= session.expiresAt
      || session.authRevision !== currentRevision) {
      await this.redis.client.del(this.key(token));
      return false;
    }
    return true;
  }

  private key(token: string): string {
    return `an30:one-c-exchange:session:${token}`;
  }
}
