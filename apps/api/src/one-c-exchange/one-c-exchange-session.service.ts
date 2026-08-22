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

import { RedisService } from "../infrastructure/redis.service.js";

// 1C is expected to drive checkauth -> init -> file (many chunks) -> import
// (many polls) back to back for one export, but a 30-40k SKU catalog can
// take a while to upload and apply. Long enough to comfortably cover that,
// short enough that an abandoned session does not linger forever.
const SESSION_TTL_SECONDS = 2 * 60 * 60;

@Injectable()
export class OneCExchangeSessionService {
  readonly cookieName = "an30_1c_exchange";

  constructor(private readonly redis: RedisService) {}

  async issue(ipAddress: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.redis.ensureConnected();
    // Bind the opaque cookie to the source address that passed the CIDR
    // allowlist during checkauth. Otherwise a copied token would bypass the
    // integration's IP restriction for its full two-hour lifetime.
    await this.redis.client.set(this.key(token), ipAddress, "EX", SESSION_TTL_SECONDS);
    return token;
  }

  /** Verifies a session token and slides its expiry so a long chunked import does not time out mid-poll. */
  async verify(token: string | undefined, ipAddress: string): Promise<boolean> {
    if (!token) return false;
    await this.redis.ensureConnected();
    const boundIp = await this.redis.client.get(this.key(token));
    if (boundIp !== ipAddress) return false;
    const extended = await this.redis.client.expire(this.key(token), SESSION_TTL_SECONDS);
    return extended === 1;
  }

  private key(token: string): string {
    return `an30:one-c-exchange:session:${token}`;
  }
}
