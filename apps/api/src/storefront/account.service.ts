import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";

import { AccountAvatarUpdateSchema, customerAvatarKey, publicProductName } from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { assertStrongPassword } from "../auth/auth.service.js";
import { STORAGE_PROVIDER, type StorageProvider } from "../adapters/provider-contracts.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { PasswordService } from "../security/password.service.js";
import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import {
  AccountListQuerySchema,
  AccountUpdateSchema,
  AddressCreateSchema,
  AddressIdSchema,
  AddressUpdateSchema,
  PasswordChangeSchema,
  ProductActionSchema,
} from "./storefront.schemas.js";

interface RequestMetadata {
  ipAddress: string;
  userAgent?: string;
}

interface AccountRow {
  avatar_key: string | null;
  created_at: Date;
  display_name: string | null;
  email: string;
  id: string;
  phone: string | null;
}

/** The profile as the storefront sees it; `avatarKey` is never empty. */
function accountView(row: AccountRow) {
  return {
    avatarChosen: row.avatar_key !== null,
    avatarKey: customerAvatarKey(row.id, row.avatar_key),
    createdAt: row.created_at.toISOString(),
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
  };
}

interface ProductListRow {
  amount_kopeks: string | null;
  available_quantity: string;
  brand_name: string | null;
  category_name: string | null;
  category_slug: string | null;
  created_at: Date;
  id: string;
  name: string;
  primary_image_id: string | null;
  sku: string;
  slug: string;
}

interface AddressRow {
  apartment: string | null;
  city: string;
  created_at: Date;
  delivery_note: string | null;
  house: string;
  id: string;
  is_default: boolean;
  label: string;
  phone: string;
  postal_code: string | null;
  recipient_name: string;
  region: string;
  street: string;
  updated_at: Date;
}

const PUBLIC_ACCOUNT_PRODUCT_FILTERS = `product.is_active AND product.deleted_at IS NULL
  AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
  AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))`;

function parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InternalServerErrorException(`Некорректное значение: ${label}`);
  }
  return parsed;
}

function productView(row: ProductListRow) {
  return {
    availableQuantity: safeInteger(row.available_quantity, "остаток"),
    brandName: row.brand_name,
    category: row.category_slug ? { name: row.category_name, slug: row.category_slug } : null,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    imageUrl: row.primary_image_id ? `/api/v1/catalog/media/${row.primary_image_id}` : null,
    // Without the staff's notes typed into the name in 1С («(Ш)», «+++», the shelf box): product-name.ts.
    name: publicProductName(row.name, row.sku),
    price: row.amount_kopeks === null ? null : {
      amountKopeks: safeInteger(row.amount_kopeks, "цена"),
      currency: "RUB",
    },
    sku: row.sku,
    slug: row.slug,
  };
}

@Injectable()
export class AccountService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async read(auth: AuthContext) {
    const row = (await this.database.query<AccountRow>(
      `SELECT id,email::text,phone,display_name,avatar_key,created_at
       FROM app.users
       WHERE id=$1 AND status='active' AND deleted_at IS NULL`,
      [auth.userId],
    )).rows[0];
    if (!row) throw new NotFoundException("Профиль не найден");
    return accountView(row);
  }

  /** One of the 15 shop pictures, or null to go back to the automatic one. */
  async updateAvatar(input: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const body = parseBody(AccountAvatarUpdateSchema, input);
    return this.database.transaction(async (client) => {
      const before = (await client.query<{ avatar_key: string | null }>(
        "SELECT avatar_key FROM app.users WHERE id=$1 AND status='active' AND deleted_at IS NULL FOR UPDATE",
        [auth.userId],
      )).rows[0];
      if (!before) throw new NotFoundException("Профиль не найден");
      const after = (await client.query<AccountRow>(
        `UPDATE app.users SET avatar_key=$2,updated_at=clock_timestamp() WHERE id=$1
         RETURNING id,email::text,phone,display_name,avatar_key,created_at`,
        [auth.userId, body.avatarKey],
      )).rows[0];
      if (!after) throw new NotFoundException("Профиль не найден");
      await this.audit.record({
        action: "account.avatar.updated",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: { avatarKey: after.avatar_key },
        beforeState: { avatarKey: before.avatar_key },
        entityId: auth.userId,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return accountView(after);
    });
  }

  async update(input: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const body = parseBody(AccountUpdateSchema, input);
    try {
      return await this.database.transaction(async (client) => {
        const before = (await client.query<AccountRow>(
          `SELECT id,email::text,phone,display_name,avatar_key,created_at
           FROM app.users
           WHERE id=$1 AND status='active' AND deleted_at IS NULL
           FOR UPDATE`,
          [auth.userId],
        )).rows[0];
        if (!before) throw new NotFoundException("Профиль не найден");
        const after = (await client.query<AccountRow>(
          `UPDATE app.users SET
             display_name=CASE WHEN $2::boolean THEN $3 ELSE display_name END,
             phone=CASE WHEN $4::boolean THEN $5 ELSE phone END
           WHERE id=$1
           RETURNING id,email::text,phone,display_name,avatar_key,created_at`,
          [
            auth.userId,
            body.displayName !== undefined,
            body.displayName ?? null,
            body.phone !== undefined,
            body.phone ?? null,
          ],
        )).rows[0];
        if (!after) throw new NotFoundException("Профиль не найден");
        await this.audit.record({
          action: "account.profile.updated",
          actorRole: auth.role,
          actorUserId: auth.userId,
          afterState: { displayName: after.display_name, phoneChanged: after.phone !== before.phone },
          beforeState: { displayName: before.display_name },
          entityId: auth.userId,
          entityType: "user",
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        }, client);
        return accountView(after);
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ConflictException("Этот телефон уже используется");
      }
      throw error;
    }
  }

  async changePassword(input: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const body = parseBody(PasswordChangeSchema, input);
    if (body.currentPassword === body.newPassword) {
      throw new BadRequestException("Новый пароль должен отличаться от текущего");
    }
    const snapshot = (await this.database.query<{ email: string; password_hash: string | null }>(
      "SELECT email::text,password_hash FROM app.users WHERE id=$1 AND deleted_at IS NULL",
      [auth.userId],
    )).rows[0];
    if (!snapshot || !(await this.passwords.verify(body.currentPassword, snapshot.password_hash))) {
      throw new UnauthorizedException("Текущий пароль указан неверно");
    }
    assertStrongPassword(body.newPassword, snapshot.email);
    const newHash = await this.passwords.hash(body.newPassword);

    await this.database.transaction(async (client) => {
      const locked = (await client.query<{ password_hash: string | null }>(
        "SELECT password_hash FROM app.users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [auth.userId],
      )).rows[0];
      if (!locked || !(await this.passwords.verify(body.currentPassword, locked.password_hash))) {
        throw new ConflictException("Пароль уже был изменён. Войдите снова");
      }
      await client.query(
        `UPDATE app.users SET password_hash=$2,password_changed_at=clock_timestamp() WHERE id=$1`,
        [auth.userId, newHash],
      );
      await client.query(
        `UPDATE app.auth_sessions
         SET revoked_at=clock_timestamp(),revoke_reason='password_changed'
         WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
        [auth.userId, auth.sessionId],
      );
      await client.query(
        `UPDATE app.password_reset_tokens
         SET used_at=clock_timestamp()
         WHERE user_id=$1 AND used_at IS NULL`,
        [auth.userId],
      );
      await this.audit.record({
        action: "account.password.changed",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: auth.userId,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
    });
    return { message: "Пароль изменён. Остальные сессии завершены" };
  }

  async wishlist(input: unknown, auth: AuthContext) {
    const query = parseBody(AccountListQuerySchema, input);
    const rows = (await this.database.query<ProductListRow>(
      `${this.productSelect("wishlist.created_at")}
       JOIN app.wishlist_items AS wishlist ON wishlist.product_id=product.id
       WHERE wishlist.user_id=$1 AND ${PUBLIC_ACCOUNT_PRODUCT_FILTERS}
       ORDER BY wishlist.created_at DESC LIMIT $2`,
      [auth.userId, query.limit, this.storage.name],
    )).rows;
    return { items: rows.map(productView) };
  }

  async addWishlist(input: unknown, auth: AuthContext) {
    const body = parseBody(ProductActionSchema, input);
    const inserted = await this.database.query<{ product_id: string }>(
      `${VISIBLE_CATEGORIES_CTE}
       INSERT INTO app.wishlist_items (user_id,product_id)
       SELECT $1,product.id FROM app.products AS product
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       WHERE product.id=$2 AND ${PUBLIC_ACCOUNT_PRODUCT_FILTERS}
       ON CONFLICT DO NOTHING RETURNING product_id`,
      [auth.userId, body.productId],
    );
    if (inserted.rowCount === 0) {
      const exists = await this.database.query(
        `SELECT 1 FROM app.wishlist_items WHERE user_id=$1 AND product_id=$2`,
        [auth.userId, body.productId],
      );
      if (exists.rowCount === 0) throw new NotFoundException("Товар не найден");
    }
    return { productId: body.productId, saved: true };
  }

  async wishlistItem(productId: string, auth: AuthContext) {
    const item = parseBody(ProductActionSchema, { productId });
    const result = await this.database.query(
      "SELECT 1 FROM app.wishlist_items WHERE user_id=$1 AND product_id=$2",
      [auth.userId, item.productId],
    );
    return { saved: Boolean(result.rowCount) };
  }

  async removeWishlist(productId: string, auth: AuthContext) {
    const id = parseBody(z.uuid(), productId);
    await this.database.query(
      "DELETE FROM app.wishlist_items WHERE user_id=$1 AND product_id=$2",
      [auth.userId, id],
    );
    return { productId: id, saved: false };
  }

  async history(input: unknown, auth: AuthContext) {
    const query = parseBody(AccountListQuerySchema, input);
    const rows = (await this.database.query<ProductListRow>(
      `${this.productSelect("viewed.last_viewed_at")}
       JOIN app.product_views AS viewed ON viewed.product_id=product.id
       WHERE viewed.user_id=$1 AND ${PUBLIC_ACCOUNT_PRODUCT_FILTERS}
       ORDER BY viewed.last_viewed_at DESC LIMIT $2`,
      [auth.userId, query.limit, this.storage.name],
    )).rows;
    return { items: rows.map(productView) };
  }

  async recordView(input: unknown, auth: AuthContext) {
    const body = parseBody(ProductActionSchema, input);
    const result = await this.database.query<{ product_id: string }>(
      `${VISIBLE_CATEGORIES_CTE}
       INSERT INTO app.product_views (user_id,product_id)
       SELECT $1,product.id FROM app.products AS product
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       WHERE product.id=$2 AND ${PUBLIC_ACCOUNT_PRODUCT_FILTERS}
       ON CONFLICT (user_id,product_id) DO UPDATE SET
         view_count=app.product_views.view_count+1,last_viewed_at=clock_timestamp()
       RETURNING product_id`,
      [auth.userId, body.productId],
    );
    if (result.rowCount === 0) throw new NotFoundException("Товар не найден");
    return { productId: body.productId, recorded: true };
  }

  async clearHistory(auth: AuthContext): Promise<void> {
    await this.database.query("DELETE FROM app.product_views WHERE user_id=$1", [auth.userId]);
  }

  async addresses(auth: AuthContext) {
    const rows = (await this.database.query<AddressRow>(
      `${this.addressSelect()}
       WHERE address.user_id=$1 AND address.deleted_at IS NULL
       ORDER BY address.is_default DESC,address.updated_at DESC,address.id`,
      [auth.userId],
    )).rows;
    return { items: rows.map((row) => this.addressView(row)) };
  }

  async createAddress(input: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const body = parseBody(AddressCreateSchema, input);
    return this.database.transaction(async (client) => {
      await client.query("SELECT id FROM app.users WHERE id=$1 FOR UPDATE", [auth.userId]);
      const addressCount = Number((await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.customer_addresses
         WHERE user_id=$1 AND deleted_at IS NULL`,
        [auth.userId],
      )).rows[0]?.count ?? 0);
      if (!Number.isSafeInteger(addressCount) || addressCount >= 20) {
        throw new ConflictException("Можно сохранить не более 20 адресов");
      }
      if (body.isDefault) {
        await client.query(
          "UPDATE app.customer_addresses SET is_default=false WHERE user_id=$1 AND deleted_at IS NULL",
          [auth.userId],
        );
      }
      const row = (await client.query<AddressRow>(
        `INSERT INTO app.customer_addresses
           (user_id,label,recipient_name,phone,postal_code,region,city,street,house,
            apartment,delivery_note,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           $12 OR NOT EXISTS (
             SELECT 1 FROM app.customer_addresses WHERE user_id=$1 AND deleted_at IS NULL
           ))
         RETURNING id,label,recipient_name,phone,postal_code,region,city,street,house,
                   apartment,delivery_note,is_default,created_at,updated_at`,
        [
          auth.userId,
          body.label,
          body.recipientName,
          body.phone,
          body.postalCode ?? null,
          body.region,
          body.city,
          body.street,
          body.house,
          body.apartment ?? null,
          body.deliveryNote ?? null,
          body.isDefault,
        ],
      )).rows[0];
      if (!row) throw new Error("Address creation did not return a row");
      await this.audit.record({
        action: "account.address.created",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: { isDefault: row.is_default },
        entityId: row.id,
        entityType: "customer_address",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return this.addressView(row);
    });
  }

  async updateAddress(
    addressIdInput: string,
    input: unknown,
    auth: AuthContext,
    metadata: RequestMetadata,
  ) {
    const addressId = parseBody(AddressIdSchema, addressIdInput);
    const body = parseBody(AddressUpdateSchema, input);
    return this.database.transaction(async (client) => {
      await client.query("SELECT id FROM app.users WHERE id=$1 FOR UPDATE", [auth.userId]);
      const before = (await client.query<AddressRow>(
        `${this.addressSelect()}
         WHERE address.id=$1 AND address.user_id=$2 AND address.deleted_at IS NULL
         FOR UPDATE`,
        [addressId, auth.userId],
      )).rows[0];
      if (!before) throw new NotFoundException("Адрес не найден");
      if (body.isDefault === false && before.is_default) {
        throw new ConflictException("Сначала назначьте другой адрес основным");
      }
      if (body.isDefault === true) {
        await client.query(
          `UPDATE app.customer_addresses SET is_default=false
           WHERE user_id=$1 AND id<>$2 AND deleted_at IS NULL`,
          [auth.userId, addressId],
        );
      }
      const row = (await client.query<AddressRow>(
        `UPDATE app.customer_addresses SET
           label=COALESCE($3,label),recipient_name=COALESCE($4,recipient_name),
           phone=COALESCE($5,phone),postal_code=CASE WHEN $6 THEN $7 ELSE postal_code END,
           region=COALESCE($8,region),city=COALESCE($9,city),street=COALESCE($10,street),
           house=COALESCE($11,house),apartment=CASE WHEN $12 THEN $13 ELSE apartment END,
           delivery_note=CASE WHEN $14 THEN $15 ELSE delivery_note END,
           is_default=COALESCE($16,is_default)
         WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL
         RETURNING id,label,recipient_name,phone,postal_code,region,city,street,house,
                   apartment,delivery_note,is_default,created_at,updated_at`,
        [
          addressId,
          auth.userId,
          body.label ?? null,
          body.recipientName ?? null,
          body.phone ?? null,
          body.postalCode !== undefined,
          body.postalCode ?? null,
          body.region ?? null,
          body.city ?? null,
          body.street ?? null,
          body.house ?? null,
          body.apartment !== undefined,
          body.apartment ?? null,
          body.deliveryNote !== undefined,
          body.deliveryNote ?? null,
          body.isDefault ?? null,
        ],
      )).rows[0];
      if (!row) throw new NotFoundException("Адрес не найден");
      await this.audit.record({
        action: "account.address.updated",
        actorRole: auth.role,
        actorUserId: auth.userId,
        afterState: { isDefault: row.is_default },
        beforeState: { isDefault: before.is_default },
        entityId: row.id,
        entityType: "customer_address",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return this.addressView(row);
    });
  }

  async deleteAddress(addressIdInput: string, auth: AuthContext, metadata: RequestMetadata) {
    const addressId = parseBody(AddressIdSchema, addressIdInput);
    await this.database.transaction(async (client) => {
      await client.query("SELECT id FROM app.users WHERE id=$1 FOR UPDATE", [auth.userId]);
      const removed = (await client.query<{ is_default: boolean; label: string }>(
        `WITH target AS (
           SELECT id,is_default,label FROM app.customer_addresses
           WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE
         ), removed AS (
           UPDATE app.customer_addresses AS address
           SET deleted_at=clock_timestamp(),is_default=false
           FROM target WHERE address.id=target.id
           RETURNING target.is_default,target.label
         ) SELECT is_default,label FROM removed`,
        [addressId, auth.userId],
      )).rows[0];
      if (!removed) throw new NotFoundException("Адрес не найден");
      if (removed.is_default) {
        await client.query(
          `UPDATE app.customer_addresses SET is_default=true
           WHERE id=(
             SELECT id FROM app.customer_addresses
             WHERE user_id=$1 AND deleted_at IS NULL
             ORDER BY updated_at DESC,id LIMIT 1
           )`,
          [auth.userId],
        );
      }
      await this.audit.record({
        action: "account.address.deleted",
        actorRole: auth.role,
        actorUserId: auth.userId,
        beforeState: { isDefault: removed.is_default },
        entityId: addressId,
        entityType: "customer_address",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
    });
  }

  private productSelect(createdAt: string) {
    return `${VISIBLE_CATEGORIES_CTE}
            SELECT product.id,product.sku::text,product.slug::text,product.name,
              brand.name AS brand_name,category.name AS category_name,
              category.slug::text AS category_slug,price.amount_kopeks::text,
              COALESCE(inventory.available_quantity,0)::text AS available_quantity,
              image.id AS primary_image_id,${createdAt} AS created_at
            FROM app.products AS product
            LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
            LEFT JOIN app.categories AS category ON category.id=product.category_id
            LEFT JOIN app.current_product_prices AS price
              ON price.product_id=product.id AND price.currency='RUB'
            LEFT JOIN LATERAL (
              SELECT SUM(balance.quantity_on_hand-balance.quantity_reserved)::bigint AS available_quantity
              FROM app.inventory_balances AS balance
              JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
              WHERE balance.product_id=product.id AND warehouse.is_active AND warehouse.deleted_at IS NULL
            ) AS inventory ON true
            LEFT JOIN LATERAL (
              SELECT product_image.id FROM app.product_images AS product_image
              JOIN app.storage_objects AS storage ON storage.id=product_image.storage_object_id
              WHERE product_image.product_id=product.id AND storage.status='available'
                AND storage.deleted_at IS NULL AND storage.provider=$3
                AND storage.mime_type IN ('image/avif','image/jpeg','image/png','image/webp')
              ORDER BY product_image.is_primary DESC,product_image.sort_order,product_image.created_at
              LIMIT 1
            ) AS image ON true`;
  }

  private addressSelect() {
    return `SELECT address.id,address.label,address.recipient_name,address.phone,
              address.postal_code,address.region,address.city,address.street,address.house,
              address.apartment,address.delivery_note,address.is_default,
              address.created_at,address.updated_at
            FROM app.customer_addresses AS address`;
  }

  private addressView(row: AddressRow) {
    return {
      apartment: row.apartment,
      city: row.city,
      createdAt: row.created_at.toISOString(),
      deliveryNote: row.delivery_note,
      house: row.house,
      id: row.id,
      isDefault: row.is_default,
      label: row.label,
      phone: row.phone,
      postalCode: row.postal_code,
      recipientName: row.recipient_name,
      region: row.region,
      street: row.street,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
