"use client";

import { useMemo, useState } from "react";
import { Badge, Button } from "@fluentui/react-components";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import { formatMoney, Pagination, RequestError, useResource } from "../workspace-utils";
import styles from "./catalog-enrichment.module.css";

/** The checks of «Качество каталога», in the order the staff go through them (catalog-quality.service.ts in the API). */
export const QUALITY_CHECK_LABELS = {
  no_brand: "Нет бренда",
  shared_number: "Номер у товаров разных разделов",
  duplicate_name: "Одинаковые названия",
  service_name: "Служебная пометка в названии",
  uncategorized: "Без раздела",
  no_sku: "Нет артикула",
  no_price: "Нет цены",
  no_photo: "Нет фото",
} as const;
export type QualityCheck = keyof typeof QUALITY_CHECK_LABELS;

interface QualityItem {
  availableQuantity: number; brand: string | null; category: string | null; code: string | null; id: string;
  name: string; priceKopeks: number | null; shownName: string; sku: string;
}
interface QualityList { action: string; check: QualityCheck; items: QualityItem[]; limit: number; offset: number; total: number }

/**
 * «Качество каталога»: one list per thing to fix in 1С, what is in stock first, with the 1С code to find the item by,
 * and the list as a table for Excel. Fixing happens in 1С; the site shows the result after the next exchange.
 */
export function CatalogQualityPanel() {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<QualityCheck>("no_brand");
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const counts = useResource(() => (open ? api<Record<QualityCheck, number>>("/staff/catalog/quality/summary") : Promise.resolve(null)), [open]);
  const list = useResource(
    () => (open ? api<QualityList>(`/staff/catalog/quality${queryString({ check, limit, offset })}`) : Promise.resolve(null)),
    [open, check, offset],
  );
  const columns = useMemo<Array<ColumnDef<QualityItem>>>(() => [
    { accessorKey: "code", cell: ({ row }) => <span>{row.original.code ?? "—"}</span>, header: "Код 1С" },
    { accessorKey: "sku", cell: ({ row }) => <strong>{row.original.sku}</strong>, header: "Артикул" },
    { accessorKey: "name", cell: ({ row }) => <div><strong>{row.original.name}</strong><div>{row.original.category ?? "Без раздела"}{row.original.brand ? ` · ${row.original.brand}` : ""}</div></div>, header: "Товар в 1С" },
    { accessorKey: "availableQuantity", cell: ({ row }) => <Badge appearance="tint" color={row.original.availableQuantity > 0 ? "success" : "informative"}>{row.original.availableQuantity} шт.</Badge>, header: "Остаток" },
    { accessorKey: "priceKopeks", cell: ({ row }) => formatMoney(row.original.priceKopeks), header: "Цена" },
  ], []);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>Качество каталога</h2>
          <p>Что поправить в 1С, по спискам: сначала товары в наличии. Каждый список выгружается в Excel с кодом 1С и подсказкой, что сделать.</p>
        </div>
        <Button aria-controls="catalog-quality" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Свернуть" : "Открыть списки"}</Button>
      </div>
      {open ? (
        <div className={styles.body} id="catalog-quality">
          <div className={styles.form} role="group" aria-label="Список">
            {(Object.keys(QUALITY_CHECK_LABELS) as QualityCheck[]).map((key) => (
              <Button appearance={key === check ? "primary" : "secondary"} key={key} onClick={() => { setCheck(key); setOffset(0); }}>
                {QUALITY_CHECK_LABELS[key]}{counts.data ? ` · ${counts.data[key].toLocaleString("ru-RU")}` : ""}
              </Button>
            ))}
          </div>
          {list.data ? (
            <p className={styles.note}>
              {list.data.action}.{" "}
              <a href={`/api/v1/staff/catalog/quality/export${queryString({ check })}`}><ArrowDownload20Regular aria-hidden="true" /> Выгрузить список в Excel (CSV)</a>
            </p>
          ) : null}
          <details className={styles.note}>
            <summary>Памятка: как заводить новый товар в 1С, чтобы он сразу встал на сайте правильно</summary>
            <ul>
              <li>Название по шаблону «Тип детали + бренд + номер + для чего»: «Фильтр масляный MANN W 914/2 Toyota».</li>
              <li>Бренд — в реквизит «Производитель», а не только в название: реквизит сильнее названия.</li>
              <li>Номер детали — в «Артикул». Код 1С артикулом не считается.</li>
              <li>Пометки для себя (коробка, аудит, «+++») — в «Описание»: оно на сайт не выводится.</li>
              <li>Товар в группу своего вида («01.04 Ф/масляный»), а не в группу поставщика («Росско», «Берг»).</li>
            </ul>
          </details>
          {counts.error ? <RequestError error={counts.error} onRetry={counts.reload} /> : null}
          {list.error ? <RequestError error={list.error} onRetry={list.reload} /> : null}
          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            emptyDescription="В этом списке товаров нет."
            emptyTitle="Всё в порядке"
            loading={list.loading}
          />
          {list.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={list.data.total} /> : null}
        </div>
      ) : null}
    </section>
  );
}
