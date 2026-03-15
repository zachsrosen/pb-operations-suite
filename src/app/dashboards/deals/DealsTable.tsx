"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import StatusDot from "./StatusDot";
import {
  STATUS_COLUMNS,
  isProjectPipeline,
  type TableDeal,
  type StatusColumn,
} from "./deals-types";
import { STAGE_COLORS, STAGE_ORDER } from "@/lib/constants";
import { formatMoney } from "@/lib/format";

interface DealsTableProps {
  deals: TableDeal[];
  sort: string;
  order: "asc" | "desc";
  onSort: (field: string) => void;
  onRowClick: (deal: TableDeal) => void;
  pipeline: string;
  /** Per-column status filters */
  statusFilters: Record<string, string[]>;
  onStatusFilterChange: (field: string, values: string[]) => void;
}

function SortArrow({ active, order }: { active: boolean; order: "asc" | "desc" }) {
  if (!active) return null;
  return <span className="ml-1 text-orange-400">{order === "asc" ? "▲" : "▼"}</span>;
}

/** Custom stage sort using STAGE_ORDER (lower index = further along) */
function stageSort(a: string, b: string, order: "asc" | "desc"): number {
  const aIdx = STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]);
  const bIdx = STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number]);
  const aPos = aIdx === -1 ? 999 : aIdx;
  const bPos = bIdx === -1 ? 999 : bIdx;
  return order === "asc" ? aPos - bPos : bPos - aPos;
}

export default function DealsTable({
  deals,
  sort,
  order,
  onSort,
  onRowClick,
  pipeline,
  statusFilters,
  onStatusFilterChange,
}: DealsTableProps) {
  const isProject = isProjectPipeline(pipeline);

  // Sort deals
  const sorted = useMemo(() => {
    const copy = [...deals];
    if (sort === "stage") {
      copy.sort((a, b) => stageSort(a.stage, b.stage, order));
    } else {
      copy.sort((a, b) => {
        const aVal = a[sort as keyof TableDeal];
        const bVal = b[sort as keyof TableDeal];
        if (typeof aVal === "number" && typeof bVal === "number") {
          return order === "desc" ? bVal - aVal : aVal - bVal;
        }
        const aStr = String(aVal ?? "");
        const bStr = String(bVal ?? "");
        return order === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
      });
    }
    return copy;
  }, [deals, sort, order]);

  // Collect unique status values per column (for filter popovers)
  const statusOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const col of STATUS_COLUMNS) {
      const set = new Set<string>();
      for (const deal of deals) {
        const val = deal[col.key as keyof TableDeal] as string | null;
        if (val) set.add(val);
      }
      map[col.key] = set;
    }
    return map;
  }, [deals]);

  const thClass = "px-2 py-2 text-left text-muted text-xs font-semibold whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors";
  const tdClass = "px-2 py-2 text-sm";

  return (
    <div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-t-border bg-surface-2/50">
            <th className={`${thClass} min-w-[160px]`} onClick={() => onSort("name")}>
              Deal Name <SortArrow active={sort === "name"} order={order} />
            </th>
            <th className={`${thClass} w-[100px]`} onClick={() => onSort("stage")}>
              Stage <SortArrow active={sort === "stage"} order={order} />
            </th>
            <th className={`${thClass} w-[90px]`} onClick={() => onSort("pbLocation")}>
              Location <SortArrow active={sort === "pbLocation"} order={order} />
            </th>
            <th className={`${thClass} w-[80px] text-right`} onClick={() => onSort("amount")}>
              Amount <SortArrow active={sort === "amount"} order={order} />
            </th>
            {isProject &&
              STATUS_COLUMNS.map((col) => (
                <StatusColumnHeader
                  key={col.key}
                  col={col}
                  selected={statusFilters[col.key] || []}
                  options={[...statusOptions[col.key] || []]}
                  onChange={(vals) => onStatusFilterChange(col.key, vals)}
                />
              ))}
            {!isProject &&
              STATUS_COLUMNS.map((col) => (
                <th key={col.key} className={`${thClass} w-[36px] text-center`} title={col.fullName}>
                  <span className="text-muted/50">{col.abbrev}</span>
                </th>
              ))}
            {isProject && (
              <th className={`${thClass} w-[80px]`} onClick={() => onSort("dealOwner")}>
                Owner <SortArrow active={sort === "dealOwner"} order={order} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((deal) => (
            <tr
              key={deal.id}
              onClick={() => onRowClick(deal)}
              className="border-b border-t-border/50 cursor-pointer hover:bg-surface-2/40 transition-colors"
            >
              <td className={`${tdClass} font-medium text-foreground truncate max-w-[250px]`} title={deal.name}>
                {deal.name}
              </td>
              <td className={tdClass}>
                <span
                  className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{
                    backgroundColor: `${STAGE_COLORS[deal.stage]?.hex || "#71717A"}22`,
                    color: STAGE_COLORS[deal.stage]?.hex || "#71717A",
                  }}
                >
                  {deal.stage}
                </span>
              </td>
              <td className={`${tdClass} text-muted`}>{deal.pbLocation}</td>
              <td className={`${tdClass} text-right text-muted`}>{formatMoney(deal.amount)}</td>
              {isProject &&
                STATUS_COLUMNS.map((col) => (
                  <td key={col.key} className={`${tdClass} text-center`}>
                    <StatusDot value={deal[col.key as keyof TableDeal] as string | null} />
                  </td>
                ))}
              {!isProject &&
                STATUS_COLUMNS.map((col) => (
                  <td key={col.key} className={`${tdClass} text-center`}>
                    <StatusDot value={null} unavailable />
                  </td>
                ))}
              {isProject && (
                <td className={`${tdClass} text-muted text-[11px] truncate max-w-[80px]`} title={deal.dealOwner || ""}>
                  {deal.dealOwner || "—"}
                </td>
              )}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={isProject ? 13 : 12} className="text-center py-12 text-muted">
                No deals match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Legend */}
      <div className="flex gap-4 px-4 py-2.5 border-t border-t-border text-xs text-muted">
        <span><span style={{ color: "#4ade80" }}>●</span> Complete</span>
        <span><span style={{ color: "#38bdf8" }}>●</span> In Progress</span>
        <span><span style={{ color: "#facc15" }}>●</span> Pending</span>
        <span><span style={{ color: "#f87171" }}>●</span> Issue</span>
        <span><span style={{ color: "#555" }}>○</span> Not Started</span>
      </div>
    </div>
  );
}

// --- Status Column Header with filter popover ---

function StatusColumnHeader({
  col,
  selected,
  options,
  onChange,
}: {
  col: StatusColumn;
  selected: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = useCallback(
    (val: string) => {
      if (selected.includes(val)) {
        onChange(selected.filter((v) => v !== val));
      } else {
        onChange([...selected, val]);
      }
    },
    [selected, onChange]
  );

  const hasFilter = selected.length > 0;

  return (
    <th
      ref={ref}
      className="px-1 py-2 text-center text-muted text-xs font-semibold whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors w-[36px] relative"
      title={col.fullName}
      onClick={() => setOpen(!open)}
    >
      {col.abbrev}
      {hasFilter && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400" />
      )}

      {open && options.length > 0 && (
        <div
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-48 bg-surface-elevated border border-t-border rounded-lg shadow-card-lg text-left font-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1.5 max-h-48 overflow-auto">
            {options.sort().map((opt) => (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className="flex items-center gap-2 w-full px-2 py-1 text-xs text-foreground/80 hover:bg-surface-2 rounded"
              >
                <span
                  className={`w-3 h-3 border rounded flex items-center justify-center ${
                    selected.includes(opt) ? "bg-orange-500 border-orange-500" : "border-muted"
                  }`}
                >
                  {selected.includes(opt) && (
                    <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </span>
                {opt}
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-t-border p-1.5">
              <button
                onClick={() => onChange([])}
                className="text-[10px] text-muted hover:text-foreground px-2 py-0.5"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </th>
  );
}
