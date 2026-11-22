import { Module } from "@nestjs/common";
import { ClientHubController } from "./client-hub.controller.js";
import { ClientHubService } from "./client-hub.service.js";
@Module({ controllers: [ClientHubController], providers: [ClientHubService] })
export class ClientHubModule {}
