import type { ContactRequestStatus, OrderStatus, PaymentStatus, Role, SupplierWaitlistStatus } from "@an30/contracts";

export interface SessionView {
  email: string;
  mfaSetupRequired: boolean;
  mfaVerified: boolean;
  role: Role;
  userId: string;
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface OrderRow {
  createdAt: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  id: string;
  itemCount: number;
  paidAmountKopeks: number;
  publicNumber: string;
  status: OrderStatus;
  totalAmountKopeks: number;
  version: number;
}

export interface OrderDetail {
  contact: { email: string; name: string; phone: string };
  createdAt: string;
  customerNote: string | null;
  delivery: { address?: string; method: "needs_quote" | "pickup" };
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
    status: PaymentStatus;
  }>;
  publicNumber: string;
  status: OrderStatus;
  subtotalKopeks: number;
  totalAmountKopeks: number;
  version: number;
}

export interface ChatRow {
  assignedName: string | null;
  assignedStaffId: string | null;
  createdAt: string;
  customerEmail: string | null;
  customerName: string | null;
  id: string;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  orderId: string | null;
  orderNumber: string | null;
  status: "closed" | "open" | "waiting_customer" | "waiting_staff";
  subject: string | null;
  unreadCount: number;
  version: number;
}

export interface ChatMessage {
  attachments: Array<{
    byteSize: number;
    id: string;
    mimeType: string;
    originalName: string;
  }>;
  body: string | null;
  clientMessageId: string | null;
  createdAt: string;
  id: string;
  messageType: "attachment" | "system" | "text";
  replyToId: string | null;
  senderKind: "customer" | "guest" | "staff" | "system";
  senderUserId: string | null;
  sequence: string;
}

export type ContactRequestSource = "contacts" | "expert_help" | "vin_request";

export interface ContactRequestRow {
  assignedName: string | null;
  assignedStaffId: string | null;
  createdAt: string;
  customerEmailMasked: string | null;
  customerNameMasked: string;
  customerPhoneMasked: string | null;
  id: string;
  messageLength: number;
  resolvedAt: string | null;
  source: ContactRequestSource;
  status: ContactRequestStatus;
  updatedAt: string;
  version: number;
}

export interface ContactRequestDetail {
  assignedName: string | null;
  assignedStaffId: string | null;
  createdAt: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string | null;
  id: string;
  message: string;
  resolvedAt: string | null;
  source: ContactRequestSource;
  status: ContactRequestStatus;
  updatedAt: string;
  version: number;
}

// Rossko supplier waiting list ("в ожидание"). Deliberately its own shape —
// a supplier part is never a catalog product, so this never shares fields
// with CatalogRow/OrderRow, and priceKopeks here is always a supplier quote,
// never the shop's own 1C price.
export interface SupplierWaitlistRow {
  assignedName: string | null;
  assignedStaffId: string | null;
  createdAt: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string | null;
  deliveryTime: string | null;
  id: string;
  partBrand: string;
  partName: string;
  partNumber: string;
  priceKopeks: number;
  quantity: number;
  resolvedAt: string | null;
  status: SupplierWaitlistStatus;
  supplier: string;
  updatedAt: string;
  version: number;
}

export interface CatalogRow {
  availableQuantity: number;
  categoryName: string | null;
  currency: string | null;
  externalId: string | null;
  id: string;
  isActive: boolean;
  isDemo: boolean;
  name: string;
  priceKopeks: number | null;
  sku: string;
  sourceVersion: number;
  updatedAt: string;
}

export interface InvoiceRow {
  amountKopeks: number;
  createdAt: string;
  customerName: string | null;
  id: string;
  invoiceNumber: string;
  issuedAt: string | null;
  orderId: string | null;
  orderNumber: string | null;
  status: "cancelled" | "draft" | "issued";
  version: number;
}

export interface ImportRow {
  appliedAt: string | null;
  appliedRows: number;
  errorSummary: unknown;
  externalBatchId: string;
  id: string;
  invalidRows: number;
  rolledBackAt: string | null;
  skippedRows: number;
  status: string;
  totalRows: number;
  uploadedAt: string;
  validRows: number;
  validatedAt: string | null;
}

export interface ImportPreviewRow {
  change_kind: string | null;
  entity_type: string;
  external_id: string | null;
  normalized_payload: unknown;
  row_number: number;
  status: string;
  validation_errors: Array<{ code: string; message: string }> | null;
}

export interface ImportPreview extends ImportRow {
  conflicts: Record<string, number>;
  page: { limit: number; offset: number; rows: ImportPreviewRow[] };
}

export interface TeamRow {
  createdAt: string;
  displayName: string | null;
  email: string;
  employeeCode: string | null;
  id: string;
  positionTitle: string | null;
  role: Exclude<Role, "customer">;
  status: string;
  totpEnabled: boolean;
  userId: string;
}

export interface AuditRow {
  action: string;
  actorEmail: string | null;
  actorRole: Role | null;
  actorUserId: string | null;
  createdAt: string;
  entityId: string | null;
  entityType: string;
  id: string;
}
