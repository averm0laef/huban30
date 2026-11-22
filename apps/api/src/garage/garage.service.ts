import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";

const id = z.number().int().min(1).max(2_000_000_000);
export const GarageVehicleSchema = z.object({
  catalog: z.object({ modelId: id, modificationId: id.optional() }).strict().optional(),
  details: z.string().trim().max(200).optional(),
  primary: z.boolean().optional(),
  tecdoc: z.object({ genId: id.optional(), mfaId: id.optional(), msId: id }).strict().optional(),
  title: z.string().trim().min(2).max(120),
}).strict();

const MAX_VEHICLES = 10;

interface VehicleRow {
  catalog_model_id: number | null; catalog_modification_id: number | null; created_at: Date; details: string | null; id: string;
  is_primary: boolean; source: string; tecdoc_gen_id: number | null; tecdoc_mfa_id: number | null; tecdoc_ms_id: number | null; title: string;
}

const COLUMNS = "id,title,details,source,tecdoc_mfa_id,tecdoc_ms_id,tecdoc_gen_id,catalog_model_id,catalog_modification_id,is_primary,created_at";

function view(row: VehicleRow) {
  return {
    catalog: row.catalog_model_id ? { modelId: row.catalog_model_id, ...(row.catalog_modification_id ? { modificationId: row.catalog_modification_id } : {}) } : null,
    createdAt: row.created_at.toISOString(),
    details: row.details,
    id: row.id,
    isPrimary: row.is_primary,
    tecdoc: row.tecdoc_ms_id ? {
      msId: row.tecdoc_ms_id, ...(row.tecdoc_gen_id ? { genId: row.tecdoc_gen_id } : {}), ...(row.tecdoc_mfa_id ? { mfaId: row.tecdoc_mfa_id } : {}),
    } : null,
    title: row.title,
  };
}

/**
 * «Гараж»: the cars a customer saved in the account. The record is the
 * customer's own choice (a name and the ids of that choice), so the site can
 * say «подходит вашему автомобилю» without asking again.
 */
@Injectable()
export class GarageService {
  constructor(private readonly database: DatabaseService) {}

  async list(auth: AuthContext) {
    const result = await this.database.query<VehicleRow>(
      `SELECT ${COLUMNS} FROM app.customer_vehicles WHERE user_id=$1 ORDER BY is_primary DESC,created_at DESC`, [auth.userId],
    );
    return { vehicles: result.rows.map(view) };
  }

  async add(body: unknown, auth: AuthContext) {
    const parsed = GarageVehicleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Проверьте данные автомобиля");
    const vehicle = parsed.data;
    return this.database.transaction(async (client) => {
      // One customer adding from two tabs: counted and inserted under one lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`garage:${auth.userId}`]);
      const existing = await client.query<{ count: string; has_primary: boolean }>(
        "SELECT count(*)::text AS count,COALESCE(bool_or(is_primary),false) AS has_primary FROM app.customer_vehicles WHERE user_id=$1", [auth.userId],
      );
      if (Number(existing.rows[0]!.count) >= MAX_VEHICLES) throw new ConflictException(`В гараже может быть не больше ${MAX_VEHICLES} автомобилей`);
      const primary = vehicle.primary === true || !existing.rows[0]!.has_primary;
      if (primary) await client.query("UPDATE app.customer_vehicles SET is_primary=false WHERE user_id=$1 AND is_primary", [auth.userId]);
      const inserted = await client.query<VehicleRow>(
        `INSERT INTO app.customer_vehicles
           (user_id,title,details,source,tecdoc_mfa_id,tecdoc_ms_id,tecdoc_gen_id,catalog_model_id,catalog_modification_id,is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNS}`,
        [
          auth.userId, vehicle.title, vehicle.details || null, vehicle.tecdoc ? "tecdoc" : vehicle.catalog ? "catalog" : "manual",
          vehicle.tecdoc?.mfaId ?? null, vehicle.tecdoc?.msId ?? null, vehicle.tecdoc?.genId ?? null,
          vehicle.catalog?.modelId ?? null, vehicle.catalog?.modificationId ?? null, primary,
        ],
      );
      return view(inserted.rows[0]!);
    });
  }

  async makePrimary(vehicleId: string, auth: AuthContext) {
    if (!z.uuid().safeParse(vehicleId).success) throw new NotFoundException("Автомобиль не найден");
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`garage:${auth.userId}`]);
      const owned = await client.query("SELECT 1 FROM app.customer_vehicles WHERE id=$1 AND user_id=$2", [vehicleId, auth.userId]);
      if (owned.rowCount === 0) throw new NotFoundException("Автомобиль не найден");
      await client.query("UPDATE app.customer_vehicles SET is_primary=false WHERE user_id=$1 AND is_primary", [auth.userId]);
      const updated = await client.query<VehicleRow>(
        `UPDATE app.customer_vehicles SET is_primary=true,updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 RETURNING ${COLUMNS}`, [vehicleId, auth.userId],
      );
      return view(updated.rows[0]!);
    });
  }

  async remove(vehicleId: string, auth: AuthContext) {
    if (!z.uuid().safeParse(vehicleId).success) throw new NotFoundException("Автомобиль не найден");
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`garage:${auth.userId}`]);
      const removed = await client.query<{ is_primary: boolean }>(
        "DELETE FROM app.customer_vehicles WHERE id=$1 AND user_id=$2 RETURNING is_primary", [vehicleId, auth.userId],
      );
      if (removed.rowCount === 0) throw new NotFoundException("Автомобиль не найден");
      // The newest remaining car becomes the main one.
      if (removed.rows[0]!.is_primary) {
        await client.query(
          `UPDATE app.customer_vehicles SET is_primary=true WHERE id=(
             SELECT id FROM app.customer_vehicles WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)`, [auth.userId],
        );
      }
      return { removed: true };
    });
  }
}
