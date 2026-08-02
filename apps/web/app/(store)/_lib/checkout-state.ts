export interface StorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export const GUEST_ORDER_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const MAX_GUEST_ORDERS = 20;
const MAX_STORAGE_BYTES = 32_768;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;
const ORDER_STATUSES = new Set([
  "awaiting_delivery_terms",
  "cancelled",
  "completed",
  "paid",
  "pending_payment",
  "processing",
  "ready",
  "refunded",
]);
const PAYMENT_STATUSES = new Set([
  "authorized",
  "cancelled",
  "failed",
  "partially_refunded",
  "pending",
  "refunded",
  "succeeded",
]);
const PAYMENT_KINDS = new Set(["delivery", "goods", "manual_adjustment"]);
const GUEST_ACCESS_STORAGE_KEY = "an30_guest_order_access:v1";

export interface CheckoutState {
  guestAccessToken: string | null;
  idempotentReplay: boolean;
  order: {
    id: string;
    publicNumber: string;
    status: string;
    subtotalKopeks: number;
    totalAmountKopeks: number;
  };
  payment: {
    amountKopeks: number;
    confirmationToken: string | null;
    confirmationUrl: string | null;
    externalPaymentId: string | null;
    id: string;
    provider: string;
    status: string;
  };
  reservation: { expiresAt: string; id: string } | null;
}

export interface OrderDetail {
  createdAt: string;
  customerNote: string | null;
  id: string;
  items: Array<{
    id: string;
    lineTotalKopeks: number;
    name: string;
    quantity: number;
    sku: string;
    unitPriceKopeks: number;
  }>;
  paidAmountKopeks: number;
  payments: Array<{
    amountKopeks: number;
    id: string;
    kind: string;
    provider: string;
    refundedAmountKopeks: number;
    status: string;
  }>;
  publicNumber: string;
  status: string;
  subtotalKopeks: number;
  totalAmountKopeks: number;
  version: number;
}

export interface PaymentCompletion {
  status: string;
  timedOut: boolean;
}

interface GuestAccessEntry {
  expiresAt: number;
  orderId: string;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) return null;
  return value;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function opaqueToken(value: unknown): string | null {
  return typeof value === "string" && OPAQUE_TOKEN_PATTERN.test(value) ? value : null;
}

function enumValue(value: unknown, allowed: Set<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function isoDate(value: unknown): string | null {
  const text = boundedString(value, 20, 40);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return text;
}

function confirmationPath(value: unknown, origin: string, externalPaymentId: string): string | null {
  const text = boundedString(value, 1, 512);
  if (!text) return null;
  try {
    const base = new URL(origin);
    const parsed = new URL(text, base);
    const expectedPath = `/api/v1/payments/sandbox/${encodeURIComponent(externalPaymentId)}/complete`;
    if (parsed.origin !== base.origin || parsed.username || parsed.password
      || parsed.pathname !== expectedPath || parsed.search || parsed.hash) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function invalidServerResponse(): never {
  throw new Error("Сервер вернул некорректные данные заказа");
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function parseCheckoutResponse(value: unknown, origin: string): CheckoutState {
  if (!isRecord(value) || !isRecord(value.order) || !isRecord(value.payment)
    || !isRecord(value.reservation) || typeof value.idempotentReplay !== "boolean") invalidServerResponse();

  const orderId = uuid(value.order.id);
  const publicNumber = boundedString(value.order.publicNumber, 1, 160);
  const orderStatus = enumValue(value.order.status, ORDER_STATUSES);
  const subtotalKopeks = safeInteger(value.order.subtotalKopeks);
  const totalAmountKopeks = safeInteger(value.order.totalAmountKopeks);
  const paymentId = uuid(value.payment.id);
  const amountKopeks = safeInteger(value.payment.amountKopeks);
  const provider = boundedString(value.payment.provider, 1, 40);
  const paymentStatus = enumValue(value.payment.status, PAYMENT_STATUSES);
  const externalPaymentId = boundedString(value.payment.externalPaymentId, 1, 240);
  const reservationId = uuid(value.reservation.id);
  const expiresAt = isoDate(value.reservation.expiresAt);
  const guestAccessToken = value.guestAccessToken === null ? null : opaqueToken(value.guestAccessToken);
  const confirmationToken = value.payment.confirmationToken === null
    ? null
    : opaqueToken(value.payment.confirmationToken);

  if (!orderId || !publicNumber || !orderStatus || subtotalKopeks === null || totalAmountKopeks === null
    || totalAmountKopeks < subtotalKopeks || !paymentId || amountKopeks === null || !provider
    || !paymentStatus || !externalPaymentId || !reservationId || !expiresAt
    || (value.guestAccessToken !== null && !guestAccessToken)
    || (value.payment.confirmationToken !== null && !confirmationToken)) invalidServerResponse();

  let confirmationUrl: string | null = null;
  if (provider === "sandbox" && confirmationToken) {
    confirmationUrl = confirmationPath(value.payment.confirmationUrl, origin, externalPaymentId);
    if (!confirmationUrl) invalidServerResponse();
  } else if (value.payment.confirmationUrl !== null && value.payment.confirmationUrl !== "") {
    if (provider === "sandbox") invalidServerResponse();
  }

  return {
    guestAccessToken,
    idempotentReplay: value.idempotentReplay,
    order: { id: orderId, publicNumber, status: orderStatus, subtotalKopeks, totalAmountKopeks },
    payment: {
      amountKopeks,
      confirmationToken: provider === "sandbox" ? confirmationToken : null,
      confirmationUrl,
      externalPaymentId,
      id: paymentId,
      provider,
      status: paymentStatus,
    },
    reservation: { expiresAt, id: reservationId },
  };
}

export function parseOrderDetail(value: unknown): OrderDetail {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100
    || !Array.isArray(value.payments) || value.payments.length > 50) invalidServerResponse();
  const id = uuid(value.id);
  const publicNumber = boundedString(value.publicNumber, 1, 160);
  const status = enumValue(value.status, ORDER_STATUSES);
  const createdAt = isoDate(value.createdAt);
  const subtotalKopeks = safeInteger(value.subtotalKopeks);
  const totalAmountKopeks = safeInteger(value.totalAmountKopeks);
  const paidAmountKopeks = safeInteger(value.paidAmountKopeks);
  const version = safeInteger(value.version, 1);
  const customerNote = value.customerNote === null
    ? null
    : boundedString(value.customerNote, 0, 2_000);
  if (!id || !publicNumber || !status || !createdAt || subtotalKopeks === null
    || totalAmountKopeks === null || paidAmountKopeks === null || version === null
    || totalAmountKopeks < subtotalKopeks || paidAmountKopeks > totalAmountKopeks
    || (value.customerNote !== null && customerNote === null)) invalidServerResponse();

  const items = value.items.map((entry) => {
    if (!isRecord(entry)) invalidServerResponse();
    const itemId = uuid(entry.id);
    const lineTotalKopeks = safeInteger(entry.lineTotalKopeks);
    const name = boundedString(entry.name, 1, 300);
    const quantity = safeInteger(entry.quantity, 1);
    const sku = boundedString(entry.sku, 1, 120);
    const unitPriceKopeks = safeInteger(entry.unitPriceKopeks);
    if (!itemId || lineTotalKopeks === null || !name || quantity === null || quantity > 100
      || !sku || unitPriceKopeks === null || lineTotalKopeks !== quantity * unitPriceKopeks) invalidServerResponse();
    return { id: itemId, lineTotalKopeks, name, quantity, sku, unitPriceKopeks };
  });
  const payments = value.payments.map((entry) => {
    if (!isRecord(entry)) invalidServerResponse();
    const paymentId = uuid(entry.id);
    const amountKopeks = safeInteger(entry.amountKopeks);
    const kind = enumValue(entry.kind, PAYMENT_KINDS);
    const provider = boundedString(entry.provider, 1, 40);
    const refundedAmountKopeks = safeInteger(entry.refundedAmountKopeks);
    const paymentStatus = enumValue(entry.status, PAYMENT_STATUSES);
    if (!paymentId || amountKopeks === null || !kind || !provider || refundedAmountKopeks === null
      || refundedAmountKopeks > amountKopeks || !paymentStatus) invalidServerResponse();
    return { amountKopeks, id: paymentId, kind, provider, refundedAmountKopeks, status: paymentStatus };
  });
  return {
    createdAt,
    customerNote,
    id,
    items,
    paidAmountKopeks,
    payments,
    publicNumber,
    status,
    subtotalKopeks,
    totalAmountKopeks,
    version,
  };
}

export function parsePaymentCompletion(value: unknown): PaymentCompletion {
  if (!isRecord(value)) invalidServerResponse();
  const status = enumValue(value.status, PAYMENT_STATUSES);
  if (!status || (value.timedOut !== undefined && typeof value.timedOut !== "boolean")) invalidServerResponse();
  return { status, timedOut: value.timedOut === true };
}

export function mergeOrderDetail(detail: OrderDetail, current: CheckoutState | null): CheckoutState {
  const goodsPayment = detail.payments.find((payment) => payment.kind === "goods") ?? detail.payments[0];
  if (!goodsPayment) invalidServerResponse();
  const samePayment = current?.payment.id === goodsPayment.id;
  return {
    guestAccessToken: current?.guestAccessToken ?? null,
    idempotentReplay: true,
    order: {
      id: detail.id,
      publicNumber: detail.publicNumber,
      status: detail.status,
      subtotalKopeks: detail.subtotalKopeks,
      totalAmountKopeks: detail.totalAmountKopeks,
    },
    payment: {
      amountKopeks: goodsPayment.amountKopeks,
      confirmationToken: samePayment ? current.payment.confirmationToken : null,
      confirmationUrl: samePayment ? current.payment.confirmationUrl : null,
      externalPaymentId: samePayment ? current.payment.externalPaymentId : null,
      id: goodsPayment.id,
      provider: goodsPayment.provider,
      status: goodsPayment.status,
    },
    reservation: current?.order.id === detail.id ? current.reservation : null,
  };
}

export function withoutPaymentConfirmation(state: CheckoutState): CheckoutState {
  return {
    ...state,
    payment: { ...state.payment, confirmationToken: null },
  };
}

function confirmationStorageKey(orderId: string): string {
  return `an30_checkout_confirmation:${orderId}`;
}

export function readStoredConfirmation(
  storage: StorageLike,
  orderId: string,
  origin: string,
): CheckoutState | null {
  if (!isUuid(orderId)) return null;
  const key = confirmationStorageKey(orderId);
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_STORAGE_BYTES) return null;
    const parsed = parseCheckoutResponse(JSON.parse(raw), origin);
    if (parsed.order.id !== orderId) return null;
    return parsed;
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ }
    return null;
  }
}

export function writeStoredConfirmation(
  storage: StorageLike,
  state: CheckoutState,
  origin: string,
): boolean {
  try {
    const validated = parseCheckoutResponse(state, origin);
    storage.setItem(confirmationStorageKey(validated.order.id), JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}

function readGuestEntries(storage: StorageLike, now: number): GuestAccessEntry[] {
  try {
    const raw = storage.getItem(GUEST_ACCESS_STORAGE_KEY);
    if (!raw) return [];
    if (raw.length > MAX_STORAGE_BYTES) throw new Error("too_large");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)
      || parsed.entries.length > MAX_GUEST_ORDERS) throw new Error("invalid_map");
    return parsed.entries.flatMap((entry): GuestAccessEntry[] => {
      if (!isRecord(entry)) return [];
      const orderId = uuid(entry.orderId);
      const token = opaqueToken(entry.token);
      const expiresAt = safeInteger(entry.expiresAt, 1);
      if (!orderId || !token || expiresAt === null || expiresAt <= now
        || expiresAt > now + GUEST_ORDER_ACCESS_TTL_MS) return [];
      return [{ expiresAt, orderId, token }];
    });
  } catch {
    try { storage.removeItem(GUEST_ACCESS_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    return [];
  }
}

function writeGuestEntries(storage: StorageLike, entries: GuestAccessEntry[]): boolean {
  try {
    storage.setItem(GUEST_ACCESS_STORAGE_KEY, JSON.stringify({ entries, version: 1 }));
    return true;
  } catch {
    return false;
  }
}

export function saveGuestOrderAccess(
  storage: StorageLike,
  orderId: string,
  token: string,
  now = Date.now(),
): boolean {
  if (!isUuid(orderId) || !opaqueToken(token) || !Number.isSafeInteger(now) || now < 0) return false;
  const entries = readGuestEntries(storage, now).filter((entry) => entry.orderId !== orderId);
  entries.unshift({ expiresAt: now + GUEST_ORDER_ACCESS_TTL_MS, orderId, token });
  return writeGuestEntries(storage, entries.slice(0, MAX_GUEST_ORDERS));
}

export function readGuestOrderAccess(
  storage: StorageLike,
  orderId: string,
  now = Date.now(),
): string | null {
  if (!isUuid(orderId) || !Number.isSafeInteger(now) || now < 0) return null;
  const entries = readGuestEntries(storage, now);
  const match = entries.find((entry) => entry.orderId === orderId);
  return match?.token ?? null;
}

export function removeGuestOrderAccess(storage: StorageLike, orderId: string, now = Date.now()): void {
  if (!isUuid(orderId)) return;
  const entries = readGuestEntries(storage, now).filter((entry) => entry.orderId !== orderId);
  void writeGuestEntries(storage, entries);
}
