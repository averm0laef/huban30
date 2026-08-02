import { Module } from "@nestjs/common";

import { ChatModule } from "../chat/chat.module.js";
import { StaffController } from "./staff.controller.js";
import { StaffService } from "./staff.service.js";

@Module({
  controllers: [StaffController],
  imports: [ChatModule],
  providers: [StaffService],
})
export class StaffModule {}
