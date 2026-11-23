"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Select } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Search20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { CatalogRow, Page } from "../types";
import {
  formatDate,
  formatMoney,
  Pagination,
  RequestError,
  SectionHeader,
  useResource,
} from "../workspace-utils";
import styles from "../workspace.module.css";
import { CatalogEnrichmentPanel } from "./catalog-enrichment";
import { CatalogQualityPanel } from "./catalog-quality";
import { ProductPhotosPanel } from "./product-photos";

export function CatalogView() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const limit = 25;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("availability");
    if (requested && ["all", "available", "low_stock", "out_of_stock"].includes(requested)) {
      setAvailability(requested);
    }
  }, []);

  const resource = useResource(
    () => api<Page<CatalogRow>>(`/staff/catalog${queryString({
      availability,
      direction,
      limit,
      offset,
      q: appliedSearch || undefined,
      sort,
      state,
    })}`),
    [availability, direction, offset, appliedSearch, sort, state],
  );
  const columns = useMemo<Array<ColumnDef<CatalogRow>>>(() => [
    {
      accessorKey: "sku",
      cell: ({ row }) => <strong>{row.original.sku}</strong>,
      header: "Артикул",
    },
    {
      accessorKey: "name",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.name}</strong>
          <span>{row.original.categoryName ?? "Без категории"}</span>
        </div>
      ),
      header: "Товар",
    },
    {
      accessorKey: "price",
      cell: ({ row }) => formatMoney(row.original.priceKopeks),
      header: "Цена",
    },
    {
      accessorKey: "available",
      cell: ({ row }) => (
        <Badge
          appearance="tint"
          color={row.original.availableQuantity === 0 ? "danger" : row.original.availableQuantity <= 3 ? "warning" : "success"}
        >
          {row.original.availableQuantity} шт.
        </Badge>
      ),
      header: "Доступно",
    },
    {
      id: "sourceVersion",
      cell: ({ row }) => `v${row.original.sourceVersion}`,
      header: "Версия 1С",
    },
    {
      accessorKey: "updatedAt",
      cell: ({ row }) => formatDate(row.original.updatedAt),
      header: "Обновлён",
    },
    {
      id: "state",
      cell: ({ row }) => <Badge appearance="outline">{row.original.isActive ? "Активен" : "Скрыт"}</Badge>,
      header: "Публикация",
    },
  ], []);

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Товары, цены и остатки приходят из 1С. Чтобы изменить цену или остаток, поправьте их в 1С — сайт обновится при следующем обмене."
        eyebrow="Товары"
        title="Каталог и остатки"
      />
      <CatalogQualityPanel />
      <ProductPhotosPanel />
      <CatalogEnrichmentPanel />
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск по каталогу"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && search.trim().length !== 1) { setOffset(0); setAppliedSearch(search.trim()); }
          }}
          placeholder="Название, артикул или код 1С"
          value={search}
        />
        <Button disabled={search.trim().length === 1} onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}>Найти</Button>
        <Select aria-label="Публикация" onChange={(event) => { setOffset(0); setState(event.target.value); }} value={state}>
          <option value="all">Все товары</option>
          <option value="active">Активные</option>
          <option value="inactive">Скрытые</option>
        </Select>
        <Select aria-label="Наличие" onChange={(event) => { setOffset(0); setAvailability(event.target.value); }} value={availability}>
          <option value="all">Любой остаток</option>
          <option value="available">Есть в наличии</option>
          <option value="low_stock">Малый остаток</option>
          <option value="out_of_stock">Нет в наличии</option>
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        direction={direction}
        emptyDescription="Импортируйте подтверждённую выгрузку из 1С. Демонстрационные товары в production запрещены."
        emptyTitle="Каталог пока пуст"
        loading={resource.loading}
        onSort={(nextSort, nextDirection) => { setOffset(0); setSort(nextSort); setDirection(nextDirection); }}
        sort={sort}
        sortable={["available", "name", "price", "sku", "updatedAt"]}
      />
      {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
    </>
  );
}
