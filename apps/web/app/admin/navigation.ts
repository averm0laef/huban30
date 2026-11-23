import { ROLE_PERMISSIONS, type Permission, type Role } from "@an30/contracts";

import type { StaffSection } from "./sections";

/**
 * One description of the workspace sections for everything that has to agree about them: the side menu, the
 * check behind a direct link, the «who sees what» table in «Персонал» and the browser tab title. The menu
 * hides nothing by itself — the server checks the same permission on every request.
 */

export type StaffRole = Exclude<Role, "customer">;
export const STAFF_ROLES: readonly StaffRole[] = ["manager", "director", "admin"];

export type NavigationGroupId = "sales" | "customers" | "goods" | "management";

export interface NavigationItem {
  /** What the section is for, in one line: shown in the access table. */
  about: string;
  group: NavigationGroupId | null;
  href: string;
  label: string;
  /** The permission the section's own list request needs on the server. */
  permission: Permission;
  section: StaffSection;
}

export const NAVIGATION_GROUPS: readonly { id: NavigationGroupId; label: string }[] = [
  { id: "sales", label: "Продажи" },
  { id: "customers", label: "Покупатели" },
  { id: "goods", label: "Товары" },
  { id: "management", label: "Управление" },
];

export const NAVIGATION: readonly NavigationItem[] = [
  { about: "Цифры дня, состояние сервисов, лента событий", group: null, href: "/admin", label: "Сводка", permission: "orders:read:any", section: "overview" },
  { about: "Заявки покупателей: подтверждение, сборка, выдача", group: "sales", href: "/admin/orders", label: "Заказы", permission: "orders:read:any", section: "orders" },
  { about: "Накладные к заказам", group: "sales", href: "/admin/invoices", label: "Накладные", permission: "orders:read:any", section: "invoices" },
  { about: "Заявки на подбор, звонки и вопросы с сайта", group: "customers", href: "/admin/requests", label: "Обращения", permission: "requests:read:any", section: "requests" },
  { about: "Переписка с покупателями на сайте", group: "customers", href: "/admin/chats", label: "Чаты", permission: "chat:manage:any", section: "chats" },
  { about: "Публикации в соцсетях и сообщения из мессенджеров", group: "customers", href: "/admin/client-hub", label: "Посты и мессенджеры", permission: "content:manage", section: "client-hub" },
  { about: "Товары, цены и остатки", group: "goods", href: "/admin/catalog", label: "Каталог", permission: "catalog:write", section: "catalog" },
  { about: "Журнал обменов с 1С и разделы для групп 1С", group: "goods", href: "/admin/imports", label: "Импорт 1С", permission: "catalog:import", section: "imports" },
  { about: "Продажи и выручка за период", group: "management", href: "/admin/reports", label: "Отчёты", permission: "reports:read", section: "reports" },
  { about: "Сотрудники, роли и приглашения", group: "management", href: "/admin/staff", label: "Персонал", permission: "staff:read", section: "staff" },
  { about: "Подключение 1С, подбор и поставщики", group: "management", href: "/admin/settings", label: "Настройки", permission: "settings:manage", section: "settings" },
  { about: "Кто и что менял в рабочем месте", group: "management", href: "/admin/audit", label: "Аудит", permission: "audit:read", section: "audit" },
];

export function navigationItem(section: StaffSection): NavigationItem {
  const item = NAVIGATION.find((entry) => entry.section === section);
  if (!item) throw new Error(`Раздел ${section} не описан в меню`);
  return item;
}

export function canOpenSection(role: Role, section: StaffSection): boolean {
  if (role === "customer") return false;
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(navigationItem(section).permission);
}

export function allowedNavigation(role: Role): NavigationItem[] {
  return NAVIGATION.filter((item) => canOpenSection(role, item.section));
}

/** Staff roles that may open the section, lowest first: the «ask whom» line of the refusal screen. */
export function rolesWithAccess(section: StaffSection): StaffRole[] {
  return STAFF_ROLES.filter((role) => canOpenSection(role, section));
}

export interface NavigationGroupView {
  id: NavigationGroupId | "home";
  items: NavigationItem[];
  label: string | null;
}

/** The menu as it is drawn: ungrouped items first, then each group that has at least one visible item. */
export function groupedNavigation(role: Role): NavigationGroupView[] {
  const items = allowedNavigation(role);
  const groups: NavigationGroupView[] = [];
  const home = items.filter((item) => item.group === null);
  if (home.length) groups.push({ id: "home", items: home, label: null });
  for (const group of NAVIGATION_GROUPS) {
    const own = items.filter((item) => item.group === group.id);
    if (own.length) groups.push({ id: group.id, items: own, label: group.label });
  }
  return groups;
}

export interface WorkQueue {
  chats: { unassigned: number; waitingStaff: number };
  orders: { active: number; awaitingConfirmation: number; ready: number };
}

/** How many things wait for a person in a section; sections without a queue have no number. */
export function sectionCounters(queue: WorkQueue | null): Partial<Record<StaffSection, number>> {
  if (!queue) return {};
  const counters: Partial<Record<StaffSection, number>> = {};
  if (queue.orders.awaitingConfirmation > 0) counters.orders = queue.orders.awaitingConfirmation;
  if (queue.chats.waitingStaff > 0) counters.chats = queue.chats.waitingStaff;
  return counters;
}

export function counterLabel(value: number): string {
  return value > 99 ? "99+" : String(value);
}

/**
 * Where a row of «Мониторинг веб-сервисов» is fixed. Keys come from the dashboard API: `one_c*` for the 1С
 * bases, `hub:<platform>…` for bots and communities; the rest has no screen of its own.
 */
export function serviceSection(key: string): StaffSection | null {
  if (key.startsWith("hub:")) return "client-hub";
  if (key.startsWith("one_c")) return "settings";
  if (key === "fapi" || key === "rossko") return "settings";
  return null;
}
