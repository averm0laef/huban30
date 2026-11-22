/**
 * The staff workspace sections, in navigation order.
 *
 * This lives in a plain module rather than in `staff-workspace.tsx` because
 * that file is a client component. When a server component imports a value
 * across the "use client" boundary, Next replaces the module with a client
 * reference proxy: the array itself never reaches the server, so calling
 * `.includes` on it threw `STAFF_SECTIONS.includes is not a function` and
 * every /admin/<section> route answered 500.
 *
 * Both sides import the list from here, so the boundary is never crossed.
 */
export const STAFF_SECTIONS = [
  "overview",
  "orders",
  "requests",
  "chats",
  "client-hub",
  "catalog",
  "imports",
  "invoices",
  "staff",
  "reports",
  "settings",
  "audit",
] as const;

export type StaffSection = typeof STAFF_SECTIONS[number];

export function isStaffSection(value: string): value is StaffSection {
  return (STAFF_SECTIONS as readonly string[]).includes(value);
}
