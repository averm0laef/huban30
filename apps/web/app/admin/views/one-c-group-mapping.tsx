"use client";

import { useMemo, useState } from "react";
import { Badge, Button, MessageBar, MessageBarBody, Select, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular, ArrowSort20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import { Pagination, RequestError, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";
import { ONE_C_SOURCE_LABELS, type OneCSource } from "./one-c-exchange-runs";

type MappingMode = "auto" | "by_product_name" | "inherited" | "manual";

interface GroupRow {
  groupExternalId: string;
  id: string;
  isActive: boolean;
  mode: MappingMode;
  name: string;
  path: string;
  productCount: number;
  section: { label: string; slug: string } | null;
  source: OneCSource;
  uncategorizedCount: number;
}

interface GroupList {
  items: GroupRow[];
  sections: Array<{ label: string; slug: string }>;
}

interface RecategorizeReport {
  deactivatedGroupCategories: number;
  moved: number;
  perSection: Array<{ count: number; label: string; slug: string }>;
  total: number;
}

interface UncategorizedPage {
  items: Array<{ groupName: string | null; id: string; name: string; sku: string; source: OneCSource }>;
  limit: number;
  offset: number;
  total: number;
}

interface QueueSummary { groups: Array<{ count: number; examples: string[]; head: string }>; total: number; unnamed: number }

interface PlacementRule {
  brandKey: string | null; categoryLabel: string; categorySlug: string; headStem: string | null; id: string;
  nameStems: string[]; note: string | null; skuPrefix: string | null;
}

function ruleText(rule: PlacementRule): string {
  return [
    rule.headStem ? `название начинается со слова «${rule.headStem}…»` : null,
    rule.nameStems.length ? `в названии есть ${rule.nameStems.map((stem) => `«${stem}…»`).join(" и ")}` : null,
    rule.brandKey ? `бренд ${rule.brandKey}` : null,
    rule.skuPrefix ? `артикул начинается с ${rule.skuPrefix}` : null,
  ].filter(Boolean).join(", ");
}

const MODE_LABELS: Record<MappingMode, { color: "brand" | "informative" | "success" | "warning"; hint: string; label: string }> = {
  auto: { color: "success", hint: "раздел выбран по названию группы", label: "Автоматически" },
  by_product_name: { color: "warning", hint: "название группы ничего не говорит — раздел выбирается по названию каждого товара", label: "По названию товара" },
  inherited: { color: "informative", hint: "как у родительской группы, которую выбрали вручную", label: "Как у родительской группы" },
  manual: { color: "brand", hint: "раздел выбран сотрудником", label: "Выбрано вручную" },
};

function reportText(report: RecategorizeReport): string {
  return `Готово: проверено товаров — ${report.total}, перенесено в другой раздел — ${report.moved}.`
    + (report.deactivatedGroupCategories > 0
      ? ` Отключено старых пустых разделов из групп 1С — ${report.deactivatedGroupCategories}.`
      : "");
}

/**
 * Where products of each 1С group land on the site. The site has one
 * section tree; 1С groups of both bases are only mapped into it.
 */
export function OneCGroupMapping() {
  const groups = useResource(() => api<GroupList>("/catalog/1c/groups"), []);
  const [sourceFilter, setSourceFilter] = useState<"" | OneCSource>("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RecategorizeReport | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [queueOffset, setQueueOffset] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const queueLimit = 20;
  const queue = useResource(
    () => api<UncategorizedPage>(`/catalog/uncategorized${queryString({ limit: queueLimit, offset: queueOffset })}`),
    [queueOffset, queueRevision],
  );

  const summary = useResource(() => api<QueueSummary>("/catalog/uncategorized/summary"), [queueRevision]);
  const rules = useResource(() => api<{ rules: PlacementRule[] }>("/catalog/placement-rules"), [queueRevision]);
  const [ruleDraft, setRuleDraft] = useState({ brand: "", categorySlug: "", skuPrefix: "", word: "" });

  async function addRule(): Promise<void> {
    setRunning(true);
    setMutationError(null);
    try {
      setReport(await api<RecategorizeReport>("/catalog/placement-rules", {
        body: JSON.stringify({
          categorySlug: ruleDraft.categorySlug,
          ...(ruleDraft.word.trim() ? { word: ruleDraft.word.trim() } : {}),
          ...(ruleDraft.brand.trim() ? { brand: ruleDraft.brand.trim() } : {}),
          ...(ruleDraft.skuPrefix.trim() ? { skuPrefix: ruleDraft.skuPrefix.trim() } : {}),
        }),
        method: "POST",
      }));
      setRuleDraft({ brand: "", categorySlug: "", skuPrefix: "", word: "" });
      refreshAll();
    } catch (error) {
      setMutationError(error);
    } finally {
      setRunning(false);
    }
  }

  async function removeRule(id: string): Promise<void> {
    setRunning(true);
    setMutationError(null);
    try {
      setReport(await api<RecategorizeReport>(`/catalog/placement-rules/${id}`, { method: "DELETE" }));
      refreshAll();
    } catch (error) {
      setMutationError(error);
    } finally {
      setRunning(false);
    }
  }

  async function placeProduct(productId: string, categorySlug: string): Promise<void> {
    if (!categorySlug) return;
    setSavingId(productId);
    setMutationError(null);
    try {
      await api(`/catalog/products/${productId}/category`, { body: JSON.stringify({ categorySlug }), method: "PUT" });
      refreshAll();
    } catch (error) {
      setMutationError(error);
    } finally {
      setSavingId(null);
    }
  }

  const rows = useMemo(() => (groups.data?.items ?? [])
    .filter((row) => !sourceFilter || row.source === sourceFilter)
    .filter((row) => !onlyProblems || row.uncategorizedCount > 0 || row.mode === "by_product_name"), [groups.data, sourceFilter, onlyProblems]);

  function refreshAll(): void {
    groups.reload();
    setQueueRevision((value) => value + 1);
  }

  async function changeMapping(row: GroupRow, categorySlug: string): Promise<void> {
    setSavingId(row.id);
    setMutationError(null);
    try {
      const result = await api<RecategorizeReport>("/catalog/1c/groups", {
        body: JSON.stringify({ categorySlug: categorySlug || null, groupExternalId: row.groupExternalId, source: row.source }),
        method: "PUT",
      });
      setReport(result);
      refreshAll();
    } catch (error) {
      setMutationError(error);
    } finally {
      setSavingId(null);
    }
  }

  async function recategorize(): Promise<void> {
    setRunning(true);
    setMutationError(null);
    try {
      setReport(await api<RecategorizeReport>("/catalog/recategorize", { method: "POST" }));
      refreshAll();
    } catch (error) {
      setMutationError(error);
    } finally {
      setRunning(false);
    }
  }

  const columns: Array<ColumnDef<GroupRow>> = [
    {
      id: "group",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.name}</strong>
          <span>{ONE_C_SOURCE_LABELS[row.original.source]}{row.original.path !== row.original.name ? ` · ${row.original.path}` : ""}{row.original.isActive ? "" : " · группа удалена в 1С"}</span>
        </div>
      ),
      header: "Группа в 1С",
    },
    {
      id: "products",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.productCount}</strong>
          {row.original.uncategorizedCount > 0 ? <span>{row.original.uncategorizedCount} без раздела</span> : null}
        </div>
      ),
      header: "Товаров",
    },
    {
      id: "section",
      cell: ({ row }) => {
        const mode = MODE_LABELS[row.original.mode];
        return (
          <div className={styles.cellStack}>
            <strong>{row.original.section?.label ?? "Определяется по каждому товару"}</strong>
            <span><Badge appearance="tint" color={mode.color}>{mode.label}</Badge> {mode.hint}</span>
          </div>
        );
      },
      header: "Раздел на сайте",
    },
    {
      id: "change",
      cell: ({ row }) => (
        <Select
          aria-label={`Раздел сайта для группы ${row.original.name}`}
          disabled={savingId !== null || running}
          onChange={(event) => void changeMapping(row.original, event.target.value)}
          value={row.original.mode === "manual" ? row.original.section?.slug ?? "" : ""}
        >
          <option value="">Автоматически</option>
          {(groups.data?.sections ?? []).map((section) => <option key={section.slug} value={section.slug}>{section.label}</option>)}
        </Select>
      ),
      header: "Изменить",
    },
  ];

  return (
    <section aria-labelledby="one-c-group-mapping-title" className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id="one-c-group-mapping-title">Разделы сайта для групп 1С</h2>
          <p>
            На сайте одно дерево разделов. Товар попадает в раздел так: сначала по разделу, выбранному здесь для его группы 1С,
            потом по названию группы, потом по названию самого товара. Если ничего не подошло — в «Без категории».
            Новые обмены раскладывают товары сами; кнопка нужна после изменения правил или чтобы разложить уже загруженные товары.
          </p>
        </div>
        <Button
          appearance="primary"
          disabled={running || savingId !== null}
          icon={running ? <Spinner size="tiny" /> : <ArrowSort20Regular />}
          onClick={() => void recategorize()}
        >
          Разложить товары заново
        </Button>
      </div>
      {report ? (
        <MessageBar intent="success" layout="multiline">
          <MessageBarBody>
            {reportText(report)}
            {report.perSection.length > 0
              ? ` Сейчас в разделах: ${report.perSection.map((section) => `${section.label} — ${section.count}`).join("; ")}.`
              : ""}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {mutationError ? <RequestError error={mutationError} onRetry={refreshAll} /> : null}
      <div className={styles.toolbar}>
        <Select aria-label="База 1С" onChange={(event) => setSourceFilter(event.target.value as "" | OneCSource)} value={sourceFilter}>
          <option value="">Обе базы</option>
          <option value="one_c">{ONE_C_SOURCE_LABELS.one_c}</option>
          <option value="one_c_secondary">{ONE_C_SOURCE_LABELS.one_c_secondary}</option>
        </Select>
        <Select aria-label="Какие группы показать" onChange={(event) => setOnlyProblems(event.target.value === "problems")} value={onlyProblems ? "problems" : "all"}>
          <option value="all">Все группы</option>
          <option value="problems">Требуют внимания</option>
        </Select>
        <Button icon={<ArrowClockwise20Regular />} onClick={refreshAll}>Обновить</Button>
      </div>
      {groups.error ? <RequestError error={groups.error} onRetry={groups.reload} /> : null}
      <DataTable
        columns={columns}
        data={rows}
        emptyDescription={onlyProblems
          ? "Все группы с товарами уже попадают в понятные разделы."
          : "Группы появятся после первого обмена с 1С, в котором есть список групп (классификатор)."}
        emptyTitle={onlyProblems ? "Проблемных групп нет" : "Групп 1С пока нет"}
        loading={groups.loading}
      />

      <div className={styles.settingsHeading}>
        <div>
          <h2>Правила сортировки по названию</h2>
          <p>
            Для базы 1С без групп: сайт сам раскладывает товары по слову, с которого начинается название («Амортизатор…», «Свеча…»).
            Чего он не знает — добавьте правилом: слово из названия, при необходимости бренд или начало артикула, и раздел.
            Правило сразу применяется ко всем товарам и ко всем следующим обменам.
          </p>
        </div>
      </div>
      {summary.data && summary.data.total > 0 ? (
        <p>
          Без раздела сейчас {summary.data.total} товаров. Чаще всего названия начинаются со слов:{" "}
          {summary.data.groups.slice(0, 20).map((group, index) => (
            <span key={group.head}>
              {index > 0 ? ", " : ""}
              <button className={styles.linkButton} onClick={() => setRuleDraft((draft) => ({ ...draft, word: group.head }))} title={group.examples.join("\n")} type="button">
                «{group.head}…» — {group.count}
              </button>
            </span>
          ))}
          {summary.data.unnamed > 0 ? `; без русского названия — ${summary.data.unnamed}` : ""}. Нажмите на слово, чтобы составить правило.
        </p>
      ) : null}
      <div className={styles.ruleForm}>
        <label>Название начинается со слова
          <input maxLength={40} onChange={(event) => setRuleDraft({ ...ruleDraft, word: event.target.value })} placeholder="например: фаркоп" value={ruleDraft.word} />
        </label>
        <label>Бренд (необязательно)
          <input maxLength={80} onChange={(event) => setRuleDraft({ ...ruleDraft, brand: event.target.value })} value={ruleDraft.brand} />
        </label>
        <label>Артикул начинается с (необязательно)
          <input maxLength={32} onChange={(event) => setRuleDraft({ ...ruleDraft, skuPrefix: event.target.value })} value={ruleDraft.skuPrefix} />
        </label>
        <label>Раздел
          <Select onChange={(_event, data) => setRuleDraft({ ...ruleDraft, categorySlug: data.value })} value={ruleDraft.categorySlug}>
            <option value="">Выберите раздел</option>
            {(groups.data?.sections ?? []).map((section) => <option key={section.slug} value={section.slug}>{section.label}</option>)}
          </Select>
        </label>
        <Button appearance="primary" onClick={() => void addRule()}
          disabled={running || !ruleDraft.categorySlug || !(ruleDraft.word.trim() || ruleDraft.brand.trim() || ruleDraft.skuPrefix.trim())}>
          Добавить правило
        </Button>
      </div>
      {rules.data && rules.data.rules.length > 0 ? (
        <ul className={styles.ruleList}>
          {rules.data.rules.map((rule) => (
            <li key={rule.id}>
              Если {ruleText(rule)} → <strong>{rule.categoryLabel}</strong>{" "}
              <Button appearance="subtle" disabled={running} onClick={() => void removeRule(rule.id)} size="small">Удалить</Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.settingsHeading}>
        <div>
          <h2>Товары без раздела</h2>
          <p>
            Эти товары видны на сайте только в «Без категории». Разложить их можно правилом выше, разделом для группы 1С
            или выбрать раздел прямо здесь — такой товар останется в выбранном разделе при следующих обменах.
          </p>
        </div>
      </div>
      {queue.error ? <RequestError error={queue.error} onRetry={queue.reload} /> : null}
      <DataTable
        columns={[
          { accessorKey: "sku", cell: ({ row }) => <strong>{row.original.sku}</strong>, header: "Артикул" },
          { accessorKey: "name", header: "Название" },
          {
            id: "group",
            cell: ({ row }) => `${ONE_C_SOURCE_LABELS[row.original.source]}${row.original.groupName ? ` · ${row.original.groupName}` : " · без группы"}`,
            header: "База и группа 1С",
          },
          {
            id: "place",
            cell: ({ row }) => (
              <Select aria-label={`Раздел для ${row.original.name}`} disabled={savingId !== null} onChange={(_event, data) => void placeProduct(row.original.id, data.value)} value="">
                <option value="">Выбрать раздел…</option>
                {(groups.data?.sections ?? []).map((section) => <option key={section.slug} value={section.slug}>{section.label}</option>)}
              </Select>
            ),
            header: "Положить в раздел",
          },
        ]}
        data={queue.data?.items ?? []}
        emptyDescription="Каждый товар уже лежит в своём разделе."
        emptyTitle="Товаров без раздела нет"
        loading={queue.loading}
      />
      {queue.data && queue.data.total > queueLimit
        ? <Pagination limit={queueLimit} offset={queueOffset} onChange={setQueueOffset} total={queue.data.total} />
        : null}
    </section>
  );
}
