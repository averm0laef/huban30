import { z } from "zod";

import { CONTACT_CONSENT_POLICY_VERSION } from "@an30/contracts";

const SingleLineSchema = z.string().trim().min(2).max(160)
  .regex(/^[^\u0000-\u001F\u007F]+$/u, "Недопустимые символы");
const PhoneSchema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/u, "Телефон укажите в международном формате");
const AddressLineSchema = z.string().trim().min(1).max(200)
  .regex(/^[^\u0000-\u001F\u007F]+$/u, "Недопустимые символы");

export const AccountUpdateSchema = z.object({
  displayName: SingleLineSchema.optional(),
  phone: PhoneSchema.nullable().optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.phone !== undefined,
  "Не переданы изменения",
);

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}).strict();

export const ProductActionSchema = z.object({
  productId: z.uuid(),
}).strict();

export const ContactRequestSchema = z.object({
  consent: z.literal(true, { error: "Требуется согласие на обработку данных" }),
  email: z.email().trim().toLowerCase().max(254).nullable().optional(),
  idempotencyKey: z.uuid(),
  message: z.string().trim().min(10).max(4_000),
  name: SingleLineSchema,
  phone: PhoneSchema.nullable().optional(),
  policyVersion: z.literal(CONTACT_CONSENT_POLICY_VERSION),
  source: z.enum(["contacts", "expert_help", "vin_request"]),
}).strict().superRefine((value, context) => {
  if (!value.email && !value.phone) {
    context.addIssue({ code: "custom", message: "Укажите email или телефон", path: ["email"] });
  }
});

export const PublicBannersQuerySchema = z.object({
  placement: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/u).default("home"),
}).strict();

export const PublicContentSlugSchema = z.string().trim().min(1).max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const PublicObjectIdSchema = z.uuid();

export const AccountListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
}).strict();

export const AddressCreateSchema = z.object({
  apartment: AddressLineSchema.max(40).nullable().optional(),
  city: AddressLineSchema,
  deliveryNote: z.string().trim().max(500).nullable().optional(),
  house: AddressLineSchema.max(40),
  isDefault: z.boolean().default(false),
  label: AddressLineSchema.max(80),
  phone: PhoneSchema,
  postalCode: z.string().trim().regex(/^\d{6}$/u, "Индекс должен содержать 6 цифр").nullable().optional(),
  recipientName: SingleLineSchema,
  region: AddressLineSchema,
  street: AddressLineSchema,
}).strict();

export const AddressUpdateSchema = AddressCreateSchema.omit({ isDefault: true }).partial().extend({
  isDefault: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "Не переданы изменения",
);

export const AddressIdSchema = z.uuid();

export type AccountUpdate = z.infer<typeof AccountUpdateSchema>;
export type ContactRequest = z.infer<typeof ContactRequestSchema>;
