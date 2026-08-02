"use client";

import { Button, Checkbox, Spinner } from "@fluentui/react-components";
import { ArrowSortDown20Regular, ArrowSortUp20Regular } from "@fluentui/react-icons";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import styles from "./workspace.module.css";

interface DataTableProps<T extends { id: string }> {
  columns: Array<ColumnDef<T>>;
  data: T[];
  direction?: "asc" | "desc";
  emptyDescription: string;
  emptyTitle: string;
  loading: boolean;
  onSelectionChange?: (ids: Set<string>) => void;
  onSort?: (sort: string, direction: "asc" | "desc") => void;
  selected?: Set<string>;
  sort?: string;
  sortable?: readonly string[];
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  direction = "desc",
  emptyDescription,
  emptyTitle,
  loading,
  onSelectionChange,
  onSort,
  selected = new Set<string>(),
  sort,
  sortable = [],
}: DataTableProps<T>) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id });
  const allSelected = data.length > 0 && data.every((row) => selected.has(row.id));
  const someSelected = data.some((row) => selected.has(row.id)) && !allSelected;

  function toggleAll(checked: boolean): void {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    for (const row of data) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    onSelectionChange(next);
  }

  function toggleOne(id: string, checked: boolean): void {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  if (loading) {
    return (
      <div className={styles.tableState} role="status">
        <Spinner size="small" label="Загрузка данных" />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={styles.tableState}>
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
    );
  }

  return (
    <div className={styles.tableScroller} tabIndex={0} aria-label="Таблица с горизонтальной прокруткой">
      <table className={styles.dataTable}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {onSelectionChange ? (
                <th className={styles.selectionCell}>
                  <Checkbox
                    aria-label="Выбрать все строки на странице"
                    checked={someSelected ? "mixed" : allSelected}
                    onChange={(_event, dataValue) => toggleAll(dataValue.checked === true)}
                  />
                </th>
              ) : null}
              {group.headers.map((header) => {
                const canSort = sortable.includes(header.column.id) && onSort;
                const active = sort === header.column.id;
                return (
                  <th
                    aria-sort={canSort ? active ? direction === "asc" ? "ascending" : "descending" : "none" : undefined}
                    key={header.id}
                    scope="col"
                  >
                    {canSort ? (
                      <Button
                        appearance="transparent"
                        className={styles.sortButton}
                        icon={active
                          ? direction === "asc" ? <ArrowSortUp20Regular /> : <ArrowSortDown20Regular />
                          : undefined}
                        iconPosition="after"
                        onClick={() => onSort(header.column.id, active && direction === "desc" ? "asc" : "desc")}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </Button>
                    ) : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} data-selected={selected.has(row.id) || undefined}>
              {onSelectionChange ? (
                <td className={styles.selectionCell}>
                  <Checkbox
                    aria-label={`Выбрать строку ${row.id}`}
                    checked={selected.has(row.id)}
                    onChange={(_event, dataValue) => toggleOne(row.id, dataValue.checked === true)}
                  />
                </td>
              ) : null}
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
