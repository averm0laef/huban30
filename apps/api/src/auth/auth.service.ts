import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";

import {
  AdminPendingTokenQuerySchema,
  REGISTRATION_PERSONAL_DATA_CONSENT_TEXT,
  REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
  RoleSchema,
  type AdminPendingTokenPurpose,
  type Role,
} from "@an30/contracts";

import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { normalizeConsentUserAgent } from "../security/consent-evidence.js";
import { CryptoService } from "../security/crypto.service.js";
import { PasswordService } from "../security/password.service.js";
import { TotpService } from "../security/totp.service.js";
import type { AuthContext } from "./auth-context.js";
import type {
  AcceptStaffInvitationDto,
  InviteStaffDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from "./auth.dto.js";
import { SessionService, type CreatedSession } from "./session.service.js";

interface RequestMetadata {
  ipAddress: string;
  userAgent?: string;
}

interface LoginAccountRow {
  email: string;
  failed_login_count: number;
  id: string;
  locked_until: Date | null;
  password_hash: string | null;
  role: string | null;
  staff_status: string | null;
  status: string;
  totp_confirmed_at: Date | null;
}

interface AuthResult {
  body: Record<string, unknown>;
  session: CreatedSession;
}

const GENERIC_EMAIL_MESSAGE = "Если адрес подходит, инструкция будет отправлена.";
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "пароль123456",
]);

export function assertStrongPassword(password: string, email?: string): void {
  const lower = password.toLocaleLowerCase("ru-RU");
  const localPart = email?.split("@")[0]?.toLocaleLowerCase("ru-RU");
  if (
    password.length < 12
    || password.length > 128
    || COMMON_PASSWORDS.has(lower)
    || (localPart && localPart.length >= 4 && lower.includes(localPart))
  ) {
    throw new BadRequestException("Используйте уникальную парольную фразу длиной от 12 символов");
  }
}

export function canRefreshPendingRegistration(status: string | undefined): boolean {
  return status === undefined || status === "pending_email";
}

@Injectable()
export class AuthService {
  private readonly adminTokenLookupEnabled: boolean;
  private readonly appOrigin: string;
  private readonly debugTokens: boolean;
  private readonly legalDocumentsApproved: boolean;

  constructor(
    config: ConfigService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
  ) {
    this.adminTokenLookupEnabled = config.getOrThrow<boolean>("AUTH_ADMIN_TOKEN_LOOKUP");
    this.appOrigin = config.getOrThrow<string>("APP_ORIGIN");
    this.debugTokens = config.getOrThrow<boolean>("AUTH_DEBUG_TOKENS");
    this.legalDocumentsApproved = config.getOrThrow<boolean>("LEGAL_DOCUMENTS_APPROVED");
  }

  async register(input: RegisterDto, metadata: RequestMetadata): Promise<Record<string, unknown>> {
    if (!this.legalDocumentsApproved) {
      throw new ServiceUnavailableException(
        "Регистрация временно недоступна до утверждения обязательных документов",
      );
    }
    if (
      input.personalDataConsent !== true
      || input.personalDataConsentVersion !== REGISTRATION_PERSONAL_DATA_CONSENT_VERSION
    ) {
      throw new BadRequestException("Требуется актуальное согласие на обработку персональных данных");
    }
    assertStrongPassword(input.password, input.email);
    const passwordHash = await this.passwords.hash(input.password);
    const rawToken = this.crypto.randomToken();
    const debugToken = await this.database.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('an30-account-email:' || $1::text, 0))",
        [input.email],
      );
      const existing = await client.query<{ id: string; status: string }>(
        "SELECT id, status::text FROM app.users WHERE email = $1 FOR UPDATE",
        [input.email],
      );
      const existingAccount = existing.rows[0];
      let userId = existingAccount?.id;
      if (!canRefreshPendingRegistration(existingAccount?.status)) return null;

      if (userId) {
        await client.query(
          `
            UPDATE app.users
            SET display_name = $2, password_hash = $3, password_changed_at = clock_timestamp()
            WHERE id = $1
          `,
          [userId, this.normalizeDisplayName(input.displayName), passwordHash],
        );
      } else {
        const created = await client.query<{ id: string }>(
          `
            INSERT INTO app.users (email, display_name, password_hash, password_changed_at)
            VALUES ($1, $2, $3, clock_timestamp())
            RETURNING id
          `,
          [input.email, this.normalizeDisplayName(input.displayName), passwordHash],
        );
        userId = created.rows[0]?.id;
      }
      if (!userId) throw new Error("Registration did not resolve a user identifier");

      await client.query(
        `
          INSERT INTO app.personal_data_consents
            (user_id,purpose,policy_version,document_path,consent_text,
             accepted_at,ip_address,user_agent)
          VALUES
            ($1,'account_registration',$2,'/personal-data-consent',$3,
             clock_timestamp(),$4,$5)
        `,
        [
          userId,
          REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
          REGISTRATION_PERSONAL_DATA_CONSENT_TEXT,
          metadata.ipAddress || null,
          normalizeConsentUserAgent(metadata.userAgent),
        ],
      );

      await client.query(
        `UPDATE app.email_verification_tokens SET used_at = clock_timestamp()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      await client.query(
        `
          INSERT INTO app.email_verification_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, clock_timestamp() + interval '24 hours')
        `,
        [userId, this.crypto.opaqueHash("email-verification", rawToken)],
      );
      await this.enqueueSecretEmail(
        client,
        "auth.email.verify",
        userId,
        input.email,
        rawToken,
      );
      await this.audit.record({
        action: "auth.registration.requested",
        entityId: userId,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        metadata: { personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION },
        userAgent: metadata.userAgent,
      }, client);
      return rawToken;
    });

    return {
      message: GENERIC_EMAIL_MESSAGE,
      ...(this.debugTokens && debugToken ? { developmentToken: debugToken } : {}),
    };
  }

  async verifyEmail(input: VerifyEmailDto, metadata: RequestMetadata): Promise<Record<string, unknown>> {
    const tokenHash = this.crypto.opaqueHash("email-verification", input.token);
    const account = (await this.database.query<{ id: string; password_hash: string | null }>(
      `SELECT account.id, account.password_hash
       FROM app.email_verification_tokens AS token
       JOIN app.users AS account ON account.id = token.user_id
       WHERE token.token_hash = $1 AND token.used_at IS NULL AND token.expires_at > clock_timestamp()
         AND account.status = 'pending_email' AND account.deleted_at IS NULL`,
      [tokenHash],
    )).rows[0];
    if (!account?.password_hash) throw new BadRequestException("Ссылка подтверждения недействительна или истекла");
    if (!await this.passwords.verify(input.password, account.password_hash)) {
      throw new BadRequestException("Введите пароль, указанный при регистрации");
    }

    const userId = await this.database.transaction(async (client) => {
      // Lock the account before its tokens, as register does. A refresh of
      // the pending registration invalidates the checked password and token.
      const current = await client.query(
        `SELECT 1 FROM app.users WHERE id = $1 AND password_hash = $2
         AND status = 'pending_email' AND deleted_at IS NULL FOR UPDATE`,
        [account.id, account.password_hash],
      );
      if (!current.rowCount) throw new BadRequestException("Ссылка подтверждения недействительна или истекла");
      const consumed = await client.query(
        `UPDATE app.email_verification_tokens SET used_at = clock_timestamp()
         WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > clock_timestamp()`,
        [account.id, tokenHash],
      );
      if (!consumed.rowCount) throw new BadRequestException("Ссылка подтверждения недействительна или истекла");
      await client.query(
        `
          UPDATE app.users
          SET status = 'active', email_verified_at = COALESCE(email_verified_at, clock_timestamp())
          WHERE id = $1
        `,
        [account.id],
      );
      await this.audit.record({
        action: "auth.email.verified",
        entityId: account.id,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return account.id;
    });
    return { message: "Email подтверждён", userId };
  }

  async login(input: LoginDto, metadata: RequestMetadata): Promise<AuthResult> {
    const result = await this.database.query<LoginAccountRow>(
      `
        SELECT
          account.id,
          account.email::text,
          account.password_hash,
          account.status::text,
          account.failed_login_count,
          account.locked_until,
          staff.role::text,
          staff.status::text AS staff_status,
          staff.totp_confirmed_at
        FROM app.users AS account
        LEFT JOIN app.staff_members AS staff ON staff.user_id = account.id
        WHERE account.email = $1 AND account.deleted_at IS NULL
        LIMIT 1
      `,
      [input.email],
    );
    const account = result.rows[0];
    const validPassword = await this.passwords.verify(input.password, account?.password_hash);
    const locked = account?.locked_until ? account.locked_until.getTime() > Date.now() : false;
    const eligible = account?.status === "active"
      && (!account.role || account.staff_status === "active");

    if (!account || !validPassword || locked || !eligible) {
      await this.recordFailedLogin(account, input.email, metadata);
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const authenticated = await this.database.transaction(async (client) => {
      const refreshedAccount = (await client.query<LoginAccountRow>(
        `SELECT account.id,account.email::text,account.password_hash,account.status::text,
                account.failed_login_count,account.locked_until,NULL::text AS role,
                NULL::text AS staff_status,NULL::timestamptz AS totp_confirmed_at
         FROM app.users AS account
         WHERE account.id=$1 AND account.deleted_at IS NULL
         FOR UPDATE OF account`,
        [account.id],
      )).rows[0];
      if (refreshedAccount) {
        const staff = (await client.query<{
          role: string;
          staff_status: string;
          totp_confirmed_at: Date | null;
        }>(
          `SELECT role::text,status::text AS staff_status,totp_confirmed_at
           FROM app.staff_members WHERE user_id=$1 FOR SHARE`,
          [account.id],
        )).rows[0];
        if (staff) Object.assign(refreshedAccount, staff);
      }
      const refreshedLocked = refreshedAccount?.locked_until
        ? refreshedAccount.locked_until.getTime() > Date.now()
        : false;
      const refreshedEligible = refreshedAccount?.status === "active"
        && (!refreshedAccount.role || refreshedAccount.staff_status === "active");
      if (
        !refreshedAccount
        || refreshedAccount.email !== input.email
        || refreshedAccount.password_hash !== account.password_hash
        || refreshedLocked
        || !refreshedEligible
      ) {
        await this.recordFailedLoginWithExecutor(client, refreshedAccount, input.email, metadata);
        return null;
      }

      const role: Role = refreshedAccount.role ? RoleSchema.parse(refreshedAccount.role) : "customer";
      await client.query(
        `
          UPDATE app.users
          SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL,
              last_login_at = clock_timestamp()
          WHERE id = $1
        `,
        [refreshedAccount.id],
      );
      await client.query(
        `
          INSERT INTO app.auth_attempts (email, ip_address, purpose, succeeded)
          VALUES ($1, $2, 'login', true)
        `,
        [input.email, metadata.ipAddress],
      );
      const session = await this.sessions.create(
        refreshedAccount.id,
        metadata.ipAddress,
        metadata.userAgent,
        false,
        client,
      );
      await this.audit.record({
        action: "auth.login.succeeded",
        actorRole: role,
        actorUserId: refreshedAccount.id,
        entityId: refreshedAccount.id,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return {
        body: {
          csrfToken: session.csrfToken,
          mfaRequired: role !== "customer",
          role,
          totpSetupRequired: role !== "customer" && refreshedAccount.totp_confirmed_at === null,
          userId: refreshedAccount.id,
        },
        session,
      };
    });
    if (!authenticated) throw new UnauthorizedException("Неверный email или пароль");
    return authenticated;
  }

  async forgotPassword(email: string, metadata: RequestMetadata): Promise<Record<string, unknown>> {
    const rawToken = this.crypto.randomToken();
    const debugToken = await this.database.transaction(async (client) => {
      const account = await client.query<{ id: string }>(
        `SELECT id FROM app.users
         WHERE email = $1 AND status = 'active' AND deleted_at IS NULL
         FOR UPDATE`,
        [email],
      );
      const userId = account.rows[0]?.id;
      if (!userId) return null;
      await client.query(
        `UPDATE app.password_reset_tokens SET used_at = clock_timestamp()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      await client.query(
        `
          INSERT INTO app.password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
          VALUES ($1, $2, clock_timestamp() + interval '30 minutes', $3)
        `,
        [userId, this.crypto.opaqueHash("password-reset", rawToken), metadata.ipAddress],
      );
      await this.enqueueSecretEmail(client, "auth.password.reset", userId, email, rawToken);
      await this.audit.record({
        action: "auth.password.reset_requested",
        entityId: userId,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return rawToken;
    });
    return {
      message: GENERIC_EMAIL_MESSAGE,
      ...(this.debugTokens && debugToken ? { developmentToken: debugToken } : {}),
    };
  }

  async resetPassword(input: ResetPasswordDto, metadata: RequestMetadata): Promise<Record<string, unknown>> {
    const tokenHash = this.crypto.opaqueHash("password-reset", input.token);
    const candidate = (await this.database.query<{ email: string }>(
      `SELECT account.email::text
       FROM app.password_reset_tokens AS reset
       JOIN app.users AS account ON account.id=reset.user_id
       WHERE reset.token_hash=$1 AND reset.used_at IS NULL
         AND reset.expires_at>clock_timestamp()
         AND account.status='active' AND account.deleted_at IS NULL
       LIMIT 1`,
      [tokenHash],
    )).rows[0];
    if (!candidate) throw new BadRequestException("Ссылка восстановления недействительна или истекла");
    assertStrongPassword(input.password, candidate.email);
    const passwordHash = await this.passwords.hash(input.password);
    await this.database.transaction(async (client) => {
      const selected = await client.query<{ email: string; id: string; user_id: string }>(
        `
          SELECT reset.id, reset.user_id, account.email::text
          FROM app.password_reset_tokens AS reset
          JOIN app.users AS account ON account.id=reset.user_id
          WHERE reset.token_hash = $1 AND reset.used_at IS NULL
            AND reset.expires_at > clock_timestamp()
            AND account.status='active' AND account.deleted_at IS NULL
          FOR UPDATE OF reset,account
        `,
        [tokenHash],
      );
      const token = selected.rows[0];
      if (!token) throw new BadRequestException("Ссылка восстановления недействительна или истекла");
      assertStrongPassword(input.password, token.email);
      await client.query(
        "UPDATE app.password_reset_tokens SET used_at = clock_timestamp() WHERE id = $1",
        [token.id],
      );
      await client.query(
        `
          UPDATE app.users
          SET password_hash = $2, password_changed_at = clock_timestamp(),
              token_version = token_version + 1,
              session_invalid_before = clock_timestamp(),
              failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL
          WHERE id = $1
        `,
        [token.user_id, passwordHash],
      );
      await client.query(
        `
          UPDATE app.auth_sessions
          SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
              revoke_reason = COALESCE(revoke_reason, 'password_reset')
          WHERE user_id = $1 AND revoked_at IS NULL
        `,
        [token.user_id],
      );
      await this.audit.record({
        action: "auth.password.reset_completed",
        entityId: token.user_id,
        entityType: "user",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
    });
    return { message: "Пароль изменён. Выполните вход заново." };
  }

  async logout(auth: AuthContext, metadata: RequestMetadata): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE app.auth_sessions
          SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
              revoke_reason = COALESCE(revoke_reason, 'logout')
          WHERE id = $1
        `,
        [auth.sessionId],
      );
      await this.audit.record({
        action: "auth.logout",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: auth.sessionId,
        entityType: "auth_session",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
    });
  }

  /**
   * Support tool for environments without working transactional email
   * (e.g. staging with SMTP_ENABLED=false): lets an authenticated admin read
   * back the one-time link that would otherwise have been emailed, so it can
   * be relayed to the customer or new staff member out of band. Guarded by
   * two independent layers: `AUTH_ADMIN_TOKEN_LOOKUP` (derived from
   * DEPLOYMENT_ENVIRONMENT — see config.ts, always false in production) and
   * the `auth:tokens:read` permission (admin-only, enforced by
   * PermissionsGuard, and reachable only through a fully authenticated,
   * TOTP-verified session because this route is not @AllowPendingMfa or
   * @Public). Never invalidates or issues a token — it only reveals a token
   * that registration/forgotPassword/inviteStaff already created.
   */
  async adminPendingToken(
    rawQuery: unknown,
    actor: AuthContext,
    metadata: RequestMetadata,
  ): Promise<Record<string, unknown>> {
    if (!this.adminTokenLookupEnabled) {
      throw new ForbiddenException("Недоступно в этом окружении");
    }
    const parsed = AdminPendingTokenQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException("Некорректный email");
    const { email } = parsed.data;

    const pending = await this.findPendingSecret(email);
    if (!pending) throw new NotFoundException("Нет ожидающего письма для этого email");

    await this.audit.record({
      action: "auth.admin.pending_token_viewed",
      actorRole: actor.role,
      actorUserId: actor.userId,
      entityId: pending.entityId,
      entityType: pending.entityType,
      ipAddress: metadata.ipAddress,
      metadata: { purpose: pending.purpose, targetEmailDomain: email.split("@")[1] },
      userAgent: metadata.userAgent,
    });

    return {
      email,
      expiresAt: pending.expiresAt.toISOString(),
      link: pending.link,
      purpose: pending.purpose,
    };
  }

  private async findPendingSecret(email: string): Promise<{
    entityId: string;
    entityType: string;
    expiresAt: Date;
    link: string;
    purpose: AdminPendingTokenPurpose;
  } | null> {
    const user = (await this.database.query<{ id: string; status: string }>(
      "SELECT id, status::text FROM app.users WHERE email = $1 AND deleted_at IS NULL",
      [email],
    )).rows[0];

    if (user) {
      const secret = user.status === "pending_email"
        ? await this.matchEmailVerification(user.id)
        : await this.matchPasswordReset(user.id);
      if (secret) return secret;
    }

    return this.matchStaffInvitation(email);
  }

  private async matchEmailVerification(userId: string): ReturnType<AuthService["findPendingSecret"]> {
    const row = (await this.database.query<{ expires_at: Date; token_hash: Buffer }>(
      `
        SELECT token_hash, expires_at FROM app.email_verification_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > clock_timestamp()
        ORDER BY expires_at DESC LIMIT 1
      `,
      [userId],
    )).rows[0];
    if (!row) return null;
    const token = await this.decryptMatchingOutboxToken(
      userId, "auth.email.verify", "email-verification", row.token_hash,
    );
    if (!token) return null;
    return {
      entityId: userId,
      entityType: "user",
      expiresAt: row.expires_at,
      link: this.buildPendingLink("verify", token),
      purpose: "email_verification",
    };
  }

  private async matchPasswordReset(userId: string): ReturnType<AuthService["findPendingSecret"]> {
    const row = (await this.database.query<{ expires_at: Date; token_hash: Buffer }>(
      `
        SELECT token_hash, expires_at FROM app.password_reset_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > clock_timestamp()
        ORDER BY expires_at DESC LIMIT 1
      `,
      [userId],
    )).rows[0];
    if (!row) return null;
    const token = await this.decryptMatchingOutboxToken(
      userId, "auth.password.reset", "password-reset", row.token_hash,
    );
    if (!token) return null;
    return {
      entityId: userId,
      entityType: "user",
      expiresAt: row.expires_at,
      link: this.buildPendingLink("reset", token),
      purpose: "password_reset",
    };
  }

  private async matchStaffInvitation(email: string): ReturnType<AuthService["findPendingSecret"]> {
    const row = (await this.database.query<{ expires_at: Date; id: string; token_hash: Buffer }>(
      `
        SELECT id, token_hash, expires_at FROM app.staff_invitations
        WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()
        ORDER BY expires_at DESC LIMIT 1
      `,
      [email],
    )).rows[0];
    if (!row) return null;
    const token = await this.decryptMatchingOutboxToken(
      row.id, "auth.staff.invitation", "staff-invitation", row.token_hash,
    );
    if (!token) return null;
    return {
      entityId: row.id,
      entityType: "staff_invitation",
      expiresAt: row.expires_at,
      link: this.buildPendingLink("staff-accept", token),
      purpose: "staff_invitation",
    };
  }

  /**
   * The outbox keeps every delivery attempt, so a re-registration or a
   * repeated forgot-password call can leave more than one event behind for
   * the same aggregate. Only the newest one can still match a currently
   * valid (unused, unexpired) token row, so we decrypt candidates newest
   * first and stop at the first HMAC match instead of trusting position 0.
   */
  private async decryptMatchingOutboxToken(
    aggregateId: string,
    topic: string,
    hashPurpose: string,
    tokenHash: Buffer,
  ): Promise<string | null> {
    const events = (await this.database.query<{ payload: unknown }>(
      `
        SELECT payload FROM app.outbox_events
        WHERE aggregate_type = 'auth' AND aggregate_id = $1 AND topic = $2
        ORDER BY created_at DESC LIMIT 5
      `,
      [aggregateId, topic],
    )).rows;
    for (const event of events) {
      const payload = event.payload as { encryptedToken?: unknown } | null;
      if (typeof payload?.encryptedToken !== "string") continue;
      try {
        const candidate = this.crypto.decrypt(
          Buffer.from(payload.encryptedToken, "base64url"),
          `${topic}:${aggregateId}`,
        );
        if (this.crypto.opaqueHashMatches(hashPurpose, candidate, tokenHash)) return candidate;
      } catch {
        // Not decryptable with this AAD (superseded payload) — keep scanning.
      }
    }
    return null;
  }

  private buildPendingLink(mode: "reset" | "staff-accept" | "verify", token: string): string {
    const url = new URL("/auth", this.appOrigin);
    url.searchParams.set("mode", mode);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }

  async inviteStaff(
    input: InviteStaffDto,
    actor: AuthContext,
    metadata: RequestMetadata,
  ): Promise<Record<string, unknown>> {
    const rawToken = this.crypto.randomToken();
    const invitationId = await this.database.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('an30-account-email:' || $1::text, 0))",
        [input.email],
      );
      const existingUser = await client.query("SELECT 1 FROM app.users WHERE email = $1", [input.email]);
      if (existingUser.rowCount) throw new ConflictException("Пользователь с таким email уже существует");
      await client.query(
        `
          UPDATE app.staff_invitations
          SET revoked_at = clock_timestamp()
          WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        `,
        [input.email],
      );
      const created = await client.query<{ id: string }>(
        `
          INSERT INTO app.staff_invitations (email, role, token_hash, invited_by, expires_at)
          VALUES ($1, $2, $3, $4, clock_timestamp() + interval '72 hours')
          RETURNING id
        `,
        [input.email, input.role, this.crypto.opaqueHash("staff-invitation", rawToken), actor.userId],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("Staff invitation did not return an identifier");
      await this.enqueueSecretEmail(client, "auth.staff.invitation", id, input.email, rawToken, {
        role: input.role,
      });
      await this.audit.record({
        action: "staff.invitation.created",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: { emailDomain: input.email.split("@")[1], role: input.role },
        entityId: id,
        entityType: "staff_invitation",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return id;
    });
    return {
      invitationId,
      message: "Приглашение создано",
      ...(this.debugTokens ? { developmentToken: rawToken } : {}),
    };
  }

  async acceptStaffInvitation(
    input: AcceptStaffInvitationDto,
    metadata: RequestMetadata,
  ): Promise<Record<string, unknown>> {
    assertStrongPassword(input.password);
    const passwordHash = await this.passwords.hash(input.password);
    const userId = await this.database.transaction(async (client) => {
      const selected = await client.query<{
        email: string;
        id: string;
        invited_by: string;
        role: string;
      }>(
        `
          SELECT id, email::text, role::text, invited_by
          FROM app.staff_invitations
          WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
            AND expires_at > clock_timestamp()
          FOR UPDATE
        `,
        [this.crypto.opaqueHash("staff-invitation", input.token)],
      );
      const invitation = selected.rows[0];
      if (!invitation) throw new BadRequestException("Приглашение недействительно или истекло");
      assertStrongPassword(input.password, invitation.email);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('an30-account-email:' || $1::text, 0))",
        [invitation.email],
      );
      const existing = await client.query("SELECT 1 FROM app.users WHERE email = $1", [invitation.email]);
      if (existing.rowCount) throw new ConflictException("Пользователь с таким email уже существует");
      const account = await client.query<{ id: string }>(
        `
          INSERT INTO app.users (
            email, display_name, password_hash, status, email_verified_at, password_changed_at
          ) VALUES ($1, $2, $3, 'active', clock_timestamp(), clock_timestamp())
          RETURNING id
        `,
        [invitation.email, this.normalizeDisplayName(input.displayName), passwordHash],
      );
      const id = account.rows[0]?.id;
      if (!id) throw new Error("Staff account did not return an identifier");
      await client.query(
        `
          INSERT INTO app.staff_members (user_id, role, status, invited_by)
          VALUES ($1, $2, 'active', $3)
        `,
        [id, invitation.role, invitation.invited_by],
      );
      await client.query(
        "UPDATE app.staff_invitations SET accepted_at = clock_timestamp() WHERE id = $1",
        [invitation.id],
      );
      await this.audit.record({
        action: "staff.invitation.accepted",
        actorRole: RoleSchema.parse(invitation.role),
        actorUserId: id,
        entityId: id,
        entityType: "staff_member",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return id;
    });
    return { message: "Приглашение принято. Войдите и настройте TOTP.", userId };
  }

  async setupTotp(auth: AuthContext, metadata: RequestMetadata): Promise<Record<string, unknown>> {
    if (auth.role === "customer") throw new ForbiddenException("TOTP предназначен для персонала");
    const secret = this.totp.generateSecret();
    await this.database.transaction(async (client) => {
      const staff = await client.query<{ totp_confirmed_at: Date | null }>(
        "SELECT totp_confirmed_at FROM app.staff_members WHERE user_id = $1 FOR UPDATE",
        [auth.userId],
      );
      if (!staff.rows[0]) throw new ForbiddenException("Профиль сотрудника не найден");
      if (staff.rows[0].totp_confirmed_at) throw new ConflictException("TOTP уже настроен");
      await client.query(
        `
          UPDATE app.staff_members
          SET totp_secret_ciphertext = $2, totp_last_used_step = NULL
          WHERE user_id = $1
        `,
        [auth.userId, this.crypto.encrypt(secret, `totp:${auth.userId}`)],
      );
      await client.query("DELETE FROM app.staff_recovery_codes WHERE user_id = $1", [auth.userId]);
      await this.audit.record({
        action: "auth.totp.setup_started",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: auth.userId,
        entityType: "staff_member",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
    });
    return {
      provisioningUri: this.totp.provisioningUri(secret, auth.email),
      secret,
    };
  }

  async confirmTotp(
    auth: AuthContext,
    code: string,
    metadata: RequestMetadata,
  ): Promise<{ body: Record<string, unknown>; session: CreatedSession }> {
    if (auth.role === "customer") throw new ForbiddenException("TOTP предназначен для персонала");
    return this.database.transaction(async (client) => {
      const staff = await client.query<{
        totp_confirmed_at: Date | null;
        totp_last_used_step: string | null;
        totp_secret_ciphertext: Buffer | null;
      }>(
        `
          SELECT totp_secret_ciphertext, totp_confirmed_at, totp_last_used_step
          FROM app.staff_members WHERE user_id = $1 FOR UPDATE
        `,
        [auth.userId],
      );
      const row = staff.rows[0];
      if (!row?.totp_secret_ciphertext || row.totp_confirmed_at) {
        throw new BadRequestException("Сначала начните настройку TOTP");
      }
      const secret = this.crypto.decrypt(row.totp_secret_ciphertext, `totp:${auth.userId}`);
      const step = this.totp.verify(secret, code);
      if (step === null || (row.totp_last_used_step !== null && step <= Number(row.totp_last_used_step))) {
        throw new UnauthorizedException("Неверный или уже использованный TOTP-код");
      }
      const recoveryCodes = this.totp.generateRecoveryCodes();
      await client.query(
        `
          UPDATE app.staff_members
          SET totp_confirmed_at = clock_timestamp(), totp_last_used_step = $2
          WHERE user_id = $1
        `,
        [auth.userId, step],
      );
      await client.query("DELETE FROM app.staff_recovery_codes WHERE user_id = $1", [auth.userId]);
      for (const recoveryCode of recoveryCodes) {
        await client.query(
          "INSERT INTO app.staff_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
          [auth.userId, this.crypto.opaqueHash("recovery-code", recoveryCode.toUpperCase())],
        );
      }
      const session = await this.sessions.rotateWithMfa(
        auth.sessionId,
        metadata.ipAddress,
        metadata.userAgent,
        client,
      );
      await this.audit.record({
        action: "auth.totp.confirmed",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: auth.userId,
        entityType: "staff_member",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      }, client);
      return {
        body: { csrfToken: session.csrfToken, recoveryCodes },
        session,
      };
    });
  }

  async verifyTotp(
    auth: AuthContext,
    suppliedCode: string,
    metadata: RequestMetadata,
  ): Promise<{ body: Record<string, unknown>; session: CreatedSession }> {
    if (auth.role === "customer") throw new ForbiddenException("TOTP предназначен для персонала");
    const code = suppliedCode.toUpperCase();
    return this.database.transaction(async (client) => {
      const staff = await client.query<{
        totp_confirmed_at: Date | null;
        totp_last_used_step: string | null;
        totp_secret_ciphertext: Buffer | null;
      }>(
        `
          SELECT totp_secret_ciphertext, totp_confirmed_at, totp_last_used_step
          FROM app.staff_members WHERE user_id = $1 FOR UPDATE
        `,
        [auth.userId],
      );
      const row = staff.rows[0];
      if (!row?.totp_secret_ciphertext || !row.totp_confirmed_at) {
        throw new BadRequestException("TOTP ещё не настроен");
      }

      let accepted = false;
      if (/^\d{6}$/u.test(code)) {
        const secret = this.crypto.decrypt(row.totp_secret_ciphertext, `totp:${auth.userId}`);
        const step = this.totp.verify(secret, code);
        if (step !== null && (row.totp_last_used_step === null || step > Number(row.totp_last_used_step))) {
          await client.query(
            "UPDATE app.staff_members SET totp_last_used_step = $2 WHERE user_id = $1",
            [auth.userId, step],
          );
          accepted = true;
        }
      } else {
        const recoveryHash = this.crypto.opaqueHash("recovery-code", code);
        const consumed = await client.query(
          `
            UPDATE app.staff_recovery_codes
            SET used_at = clock_timestamp()
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
            RETURNING id
          `,
          [auth.userId, recoveryHash],
        );
        accepted = Boolean(consumed.rowCount);
      }
      if (!accepted) throw new UnauthorizedException("Неверный или уже использованный код");

      const session = await this.sessions.rotateWithMfa(
        auth.sessionId,
        metadata.ipAddress,
        metadata.userAgent,
        client,
      );
      await this.audit.record({
        action: "auth.mfa.verified",
        actorRole: auth.role,
        actorUserId: auth.userId,
        entityId: auth.sessionId,
        entityType: "auth_session",
        ipAddress: metadata.ipAddress,
        metadata: { method: /^\d{6}$/u.test(code) ? "totp" : "recovery_code" },
        userAgent: metadata.userAgent,
      }, client);
      return { body: { csrfToken: session.csrfToken, verified: true }, session };
    });
  }

  private normalizeDisplayName(value: string): string {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (normalized.length < 2 || normalized.length > 120) {
      throw new BadRequestException("Некорректное отображаемое имя");
    }
    return normalized;
  }

  private async recordFailedLogin(
    account: LoginAccountRow | undefined,
    email: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await this.recordFailedLoginWithExecutor(client, account, email, metadata);
    });
  }

  private async recordFailedLoginWithExecutor(
    executor: DatabaseExecutor,
    account: LoginAccountRow | undefined,
    email: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (account) {
      await executor.query(
        `UPDATE app.users
         SET failed_login_count=failed_login_count+1,last_failed_login_at=clock_timestamp(),
             locked_until=CASE WHEN failed_login_count+1>=5
               THEN clock_timestamp()+interval '15 minutes' ELSE locked_until END
         WHERE id=$1`,
        [account.id],
      );
    }
    await executor.query(
      `INSERT INTO app.auth_attempts (email,ip_address,purpose,succeeded,failure_code)
       VALUES ($1,$2,'login',false,'invalid_credentials')`,
      [email, metadata.ipAddress],
    );
  }

  private async enqueueSecretEmail(
    client: PoolClient,
    topic: string,
    aggregateId: string,
    recipient: string,
    token: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const encryptedToken = this.crypto.encrypt(token, `${topic}:${aggregateId}`).toString("base64url");
    await client.query(
      `
        INSERT INTO app.outbox_events (topic, aggregate_type, aggregate_id, payload)
        VALUES ($1, 'auth', $2, $3::jsonb)
      `,
      [topic, aggregateId, JSON.stringify({ encryptedToken, recipient, ...extra })],
    );
  }
}
