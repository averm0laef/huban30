import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { RedisService } from "../infrastructure/redis.service.js";
import { CryptoService } from "./crypto.service.js";

const INCREMENT_WITH_EXPIRY = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async consume(scope: string, identity: string, limit: number, windowSeconds: number): Promise<void> {
    const digest = this.crypto.opaqueHash(`rate:${scope}`, identity).toString("hex");
    const key = `an30:rate:${scope}:${digest}`;
    try {
      await this.redis.ensureConnected();
      const count = Number(await this.redis.client.eval(
        INCREMENT_WITH_EXPIRY,
        1,
        key,
        String(windowSeconds),
      ));
      if (!Number.isFinite(count) || count > limit) {
        throw new HttpException("Слишком много попыток. Повторите позже.", HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Защита входа временно недоступна");
    }
  }
}
