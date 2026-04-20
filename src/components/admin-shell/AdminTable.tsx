"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface AdminTableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "right" | "center";
}

export interface AdminTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: AdminTableColumn<T>[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  sortBy?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  caption: string;
}

export function AdminTable<T>({
  rows, rowKey, columns,
  selectedIds, onToggleSelect, onToggleSelectAll,
  sortBy, onSortChange, onRowClick,
  empty, loading, error, caption,
}: AdminTableProps<T>) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  if (loading) return <div role="status" className="flex justify-center py-12 text-muted">Loading…</div>;
  if (error) return <>{error}</>;

  const allSelected = selectedIds && rows.length > 0 && rows.every((r) => selectedIds.has(rowKey(r)));
  const showSelect = !!selectedIds && !!onToggleSelect;

  function handleRowKeyDown(ev: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onRowClick?.(row);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const target = ev.currentTarget;
      const next = ev.key === "ArrowDown"
        ? (target.nextElementSibling as HTMLElement | null)
        : (target.previousElementSibling as HTMLElement | null);
      next?.focus();
    } else if (ev.key === " " && showSelect) {
      ev.preventDefault();
      onToggleSelect!(rowKey(row));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-t-border/60 bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {showSelect && (
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected ?? false}
                  onChange={onToggleSelectAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted ${
                  col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                } ${col.width ?? ""}`}
                scope="col"
              >
                {col.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => {
                      const nextDir =
                        sortBy?.key === col.key && sortBy.dir === "asc" ? "desc" : "asc";
                      onSortChange({ key: col.key, dir: nextDir });
                    }}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sortBy?.key === col.key && (
                      <span aria-hidden="true">{sortBy.dir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (showSelect ? 1 : 0)} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selectedIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  tabIndex={0}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(ev) => handleRowKeyDown(ev, row)}
                  aria-selected={isSelected || undefined}
                  className={`cursor-pointer border-t border-t-border/40 transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none ${
                    isSelected ? "bg-surface-2/70" : ""
                  }`}
                >
                  {showSelect && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect!(id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${
                        col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                      }`}
                    >
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as ReactNode}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
