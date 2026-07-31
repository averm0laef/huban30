import { Global, Module } from "@nestjs/common";

import { DatabaseService } from "./database.service.js";
import { RedisService } from "./redis.service.js";

@Global()
@Module({
  exports: [DatabaseService, RedisService],
  providers: [DatabaseService, RedisService],
})
export class InfrastructureModule {}
