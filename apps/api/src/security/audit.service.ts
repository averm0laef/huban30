import { Injectable } from "@nestjs/common";

import type { Role } from "@an30/contracts";

import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";

export interface AuditEvent {
  action: string;
  actorRole?: Role;
  actorUserId?: string;
  afterState?: unknown;
  beforeState?: unknown;
  entityId?: string;
  entityType: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(event: AuditEvent, executor: DatabaseExecutor = this.database): Promise<void> {
    await executor.query(
      `
        INSERT INTO app.audit_log (
          actor_user_id, actor_role, action, entity_type, entity_id, request_id,
          ip_address, user_agent, before_state, after_state, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
      `,
      [
        event.actorUserId ?? null,
        event.actorRole ?? null,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.requestId ?? null,
        event.ipAddress ?? null,
        event.userAgent?.slice(0, 1_000) ?? null,
        event.beforeState === undefined ? null : JSON.stringify(event.beforeState),
        event.afterState === undefined ? null : JSON.stringify(event.afterState),
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  }
}
