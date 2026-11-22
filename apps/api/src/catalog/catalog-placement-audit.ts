/**
 * What the shop's rules would do with a 1С assortment — before any exchange,
 * without a database and without touching 1С.
 *
 * An exchange file (CommerceML import.xml) is read with the exchange's own
 * parser and every item is placed by the exchange's own function, with no
 * staff rules and no sections chosen for groups by hand: the answer is what
 * the first exchange of a fresh site would decide. A plain list of names is
 * placed by the names alone.
 *
 * The CLI is src/cli/catalog-placement-audit.ts.
 */
import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import { parseImportXml } from "../one-c-exchange/commerce-ml.parser.js";
import {
  decideStorefrontCategory, STOREFRONT_CATEGORY_SLUGS, storefrontParentSlug, UNCATEGORIZED_CATEGORY_SLUG, type CategoryDecisionSource,
} from "./catalog-known-categories.js";
import { partHeadNoun } from "./catalog-part-dictionary.js";
import { groupChain, placeProduct, type PlacementContext } from "./catalog-recategorize.service.js";

export interface AuditGroup {
  name: string;
  parentExternalId: string | null;
}

export interface AuditItem {
  groupExternalId: string | null;
  name: string;
  sku: string | null;
}

export interface AuditInput {
  groups: ReadonlyMap<string, AuditGroup>;
  items: readonly AuditItem[];
}

export interface PlacementAudit {
  bySource: Record<CategoryDecisionSource, number>;
  /** 1С groups that hold items, by path: where the group's names point and what became of its items. */
  groups: Array<{ byGroup: number; byName: number; path: string; products: number; queued: number; section: string | null }>;
  /** The nouns the unsorted names are about, most frequent first. */
  queue: Array<{ count: number; example: string; head: string }>;
  sections: Array<{ count: number; label: string; shelves: Array<{ count: number; label: string }> }>;
  total: number;
  unsorted: number;
  withoutGroup: number;
}

const SECTION_LABELS = new Map(STOREFRONT_TAXONOMY.map((section) => [section.slug, section.label]));
const SHELF_LABELS = new Map(STOREFRONT_TAXONOMY.flatMap((section) => section.children.map((child) => [child.slug, child.label] as const)));
const NO_SHELF = "без подраздела";

/** An exchange file, read the way the exchange reads it. */
export function readCommerceMl(xml: string): AuditInput {
  const parsed = parseImportXml(xml);
  const groups = new Map<string, AuditGroup>();
  for (const row of parsed.headerRows) {
    if (row.entityType === "category") groups.set(row.externalId, { name: row.name, parentExternalId: row.parentExternalId });
  }
  const items = parsed.bodyRows.flatMap((row): AuditItem[] => row.entityType === "product"
    ? [{ groupExternalId: row.categoryExternalId, name: row.name, sku: row.sku }]
    : []);
  return { groups, items };
}

/** A plain list: one product per line — the name alone, or cells split by «;» or a tab, the longest Russian one being the name. */
export function readList(text: string): AuditInput {
  const items = text.split(/\r?\n/u).flatMap((line): AuditItem[] => {
    const cells = line.split(/[;\t]/u).map((cell) => cell.trim().replace(/^"|"$/gu, ""));
    const name = cells.length === 1 ? cells[0]! : [...cells].filter((cell) => /[А-Яа-яЁё]{3}/u.test(cell)).sort((a, b) => b.length - a.length)[0] ?? "";
    return name.length >= 3 && !/^(наименование|название|номенклатура)$/iu.test(name) ? [{ groupExternalId: null, name, sku: null }] : [];
  });
  return { groups: new Map(), items };
}

const shelfLabel = (slug: string): string => {
  const parent = storefrontParentSlug(slug);
  if (!parent) return slug;
  return parent === slug ? SECTION_LABELS.get(slug) ?? slug : `${SECTION_LABELS.get(parent) ?? parent} → ${SHELF_LABELS.get(slug) ?? slug}`;
};

export function auditPlacement(input: AuditInput): PlacementAudit {
  const groups = new Map([...input.groups].map(([id, group]) => [id, { manualSlug: null, name: group.name, parentExternalId: group.parentExternalId }]));
  const context: PlacementContext = {
    categoryIds: new Map(STOREFRONT_CATEGORY_SLUGS.map((slug) => [slug, slug])),
    groups: new Map([["one_c", groups]]),
    rules: [],
  };
  const bySource: Record<CategoryDecisionSource, number> = { group: 0, manual: 0, name: 0, none: 0, number: 0, rule: 0 };
  const perSection = new Map<string, Map<string, number>>();
  const perGroup = new Map<string, { byGroup: number; byName: number; products: number; queued: number }>();
  const queue = new Map<string, { count: number; example: string }>();
  let withoutGroup = 0;
  for (const item of input.items) {
    const placed = placeProduct(context, { groupExternalId: item.groupExternalId, productName: item.name, sku: item.sku, source: "one_c" });
    bySource[placed.source] += 1;
    const group = item.groupExternalId && groups.has(item.groupExternalId) ? item.groupExternalId : null;
    if (group === null) {
      withoutGroup += 1;
    } else {
      const entry = perGroup.get(group) ?? { byGroup: 0, byName: 0, products: 0, queued: 0 };
      entry.products += 1;
      if (placed.source === "group") entry.byGroup += 1;
      else if (placed.source === "none") entry.queued += 1;
      else entry.byName += 1;
      perGroup.set(group, entry);
    }
    if (placed.slug === UNCATEGORIZED_CATEGORY_SLUG) {
      const head = partHeadNoun(item.name) ?? "(без слова)";
      const entry = queue.get(head) ?? { count: 0, example: item.name.replace(/\s+/gu, " ").trim().slice(0, 80) };
      entry.count += 1;
      queue.set(head, entry);
      continue;
    }
    const section = storefrontParentSlug(placed.slug) ?? placed.slug;
    const shelves = perSection.get(section) ?? new Map<string, number>();
    const shelf = placed.slug === section ? NO_SHELF : SHELF_LABELS.get(placed.slug) ?? placed.slug;
    shelves.set(shelf, (shelves.get(shelf) ?? 0) + 1);
    perSection.set(section, shelves);
  }
  const byCountThenLabel = <T extends { count: number; label: string }>(a: T, b: T) => b.count - a.count || a.label.localeCompare(b.label, "ru");
  const pathOf = (id: string) => [...groupChain(groups, id).names].reverse().join(" / ");
  return {
    bySource,
    groups: [...perGroup].map(([id, entry]) => {
      const { slug } = decideStorefrontCategory({ groupNames: groupChain(groups, id).names, productName: "" });
      return { ...entry, path: pathOf(id), section: slug === UNCATEGORIZED_CATEGORY_SLUG ? null : shelfLabel(slug) };
    }).sort((a, b) => a.path.localeCompare(b.path, "ru")),
    queue: [...queue].map(([head, entry]) => ({ ...entry, head })).sort((a, b) => b.count - a.count || a.head.localeCompare(b.head, "ru")),
    sections: [...perSection].map(([slug, shelves]) => ({
      count: [...shelves.values()].reduce((sum, count) => sum + count, 0),
      label: SECTION_LABELS.get(slug) ?? slug,
      shelves: [...shelves].map(([label, count]) => ({ count, label })).sort(byCountThenLabel),
    })).sort(byCountThenLabel),
    total: input.items.length,
    unsorted: bySource.none,
    withoutGroup,
  };
}

const SOURCE_WORDS: ReadonlyArray<readonly [CategoryDecisionSource, string]> = [
  ["rule", "правило сотрудника"], ["manual", "раздел, выбранный для группы"], ["group", "группа 1С"], ["name", "название товара"],
  ["number", "оригинальный номер"], ["none", "ничего (без раздела)"],
];

/** The report, line by line, for the terminal. */
export function formatAudit(audit: PlacementAudit, limits: { groups?: number; queue?: number } = {}): string[] {
  const share = (count: number) => `${(audit.total === 0 ? 0 : (count / audit.total) * 100).toFixed(1)} %`;
  const pad = (count: number) => String(count).padStart(6);
  const sorted = audit.total - audit.unsorted;
  const lines = [
    `Товаров в файле: ${audit.total}. Разложено по разделам: ${sorted} (${share(sorted)}), без раздела: ${audit.unsorted} (${share(audit.unsorted)}).`,
    `Что решило: ${SOURCE_WORDS.filter(([source]) => audit.bySource[source] > 0).map(([source, words]) => `${words} — ${audit.bySource[source]}`).join(", ")}.`,
  ];
  if (audit.groups.length > 0) lines.push(`Товаров без группы 1С: ${audit.withoutGroup}.`);
  lines.push("", "По разделам:");
  for (const section of audit.sections) {
    lines.push(`  ${pad(section.count)}  ${section.label}`);
    for (const shelf of section.shelves) lines.push(`          ${pad(shelf.count)}  ${shelf.label}`);
  }
  if (audit.groups.length > 0) {
    lines.push("", "Группы 1С (товаров; легло по группе / по названию / без раздела) → куда ведёт название группы:");
    for (const group of audit.groups.slice(0, limits.groups ?? audit.groups.length)) {
      lines.push(`  ${pad(group.products)}  ${String(group.byGroup).padStart(5)} /${String(group.byName).padStart(5)} /${String(group.queued).padStart(5)}  ${group.path} → ${group.section ?? "— (решает название товара)"}`);
    }
  }
  if (audit.unsorted > 0) {
    lines.push("", "Без раздела — о чём эти названия (для правил сортировки):");
    for (const entry of audit.queue.slice(0, limits.queue ?? 40)) lines.push(`  ${pad(entry.count)}  ${entry.head}   например: ${entry.example}`);
  }
  return lines;
}
