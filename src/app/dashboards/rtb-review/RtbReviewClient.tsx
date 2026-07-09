"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import { getHubSpotDealUrl } from "@/lib/external-links";
import type { RtbQueueItem } from "@/lib/rtb-review";

interface RtbQueueResponse {
  items: RtbQueueItem[];
  lastUpdated: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

/** Distinct non-empty values from a field, sorted, as MultiSelect options. */
function optionsFrom(
  items: RtbQueueItem[],
  pick: (i: RtbQueueItem) => string | null
): FilterOption[] {
  const values = new Set<string>();
  for (const i of items) {
    const v = pick(i);
    if (v) values.add(v);
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type SortField =
  | "dealName"
  | "projectManager"
  | "location"
  | "projectType"
  | "amount"
  | "permitIssueDate"
  | "interconnectionStatus"
  | "constructionStatus"
  | "daStatus";

/** Per-field comparable value; null/undefined sort last in either direction. */
function sortValue(item: RtbQueueItem, field: SortField): string | number | null {
  const v = item[field];
  if (v == null || v === "") return null;
  return v;
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
}) {
  return (
    <span className={sortField === field ? "text-foreground" : "opacity-30"}>
      {sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "▼"}
    </span>
  );
}

export default function RtbReviewClient() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<RtbQueueResponse>({
    queryKey: ["rtb-review"],
    queryFn: async () => {
      const res = await fetch("/api/deals/rtb-review");
      if (!res.ok) throw new Error("Failed to load RTB review queue");
      return res.json();
    },
  });

  const approveDeal = useMutation({
    mutationFn: async (dealId: string) => {
      const res = await fetch(`/api/deals/rtb-review/${dealId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rtb-review"] }),
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  const [selectedPMs, setSelectedPMs] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  // Default: longest-waiting first (oldest permit issue date at the top).
  const [sortField, setSortField] = useState<SortField>("permitIssueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const pmOptions = useMemo(
    () => optionsFrom(items, (i) => i.projectManager),
    [items]
  );
  const locationOptions = useMemo(
    () => optionsFrom(items, (i) => i.location),
    [items]
  );

  const filtered = useMemo(() => {
    const subset = items.filter((i) => {
      const pmOk =
        selectedPMs.length === 0 ||
        (i.projectManager != null && selectedPMs.includes(i.projectManager));
      const locOk =
        selectedLocations.length === 0 ||
        (i.location != null && selectedLocations.includes(i.location));
      return pmOk && locOk;
    });
    return [...subset].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [items, selectedPMs, selectedLocations, sortField, sortDir]);

  return (
    <DashboardShell
      title="RTB Review Queue"
      subtitle="Permit-issued deals parked in RTB - Blocked, awaiting PM release to build"
      accentColor="red"
      fullWidth
      lastUpdated={data?.lastUpdated}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Project Manager"
          accentColor="red"
          options={pmOptions}
          selected={selectedPMs}
          onChange={setSelectedPMs}
        />
        <MultiSelectFilter
          label="Location"
          accentColor="red"
          options={locationOptions}
          selected={selectedLocations}
          onChange={setSelectedLocations}
        />
        <div className="text-xs text-muted ml-auto">
          {filtered.length}
          {filtered.length !== items.length ? ` of ${items.length}` : ""} deals
          awaiting review
        </div>
      </div>

      <div className="rounded-lg border border-t-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              {(
                [
                  ["Deal", "dealName"],
                  ["Project Manager", "projectManager"],
                  ["Location", "location"],
                  ["Deal Stage", null],
                  ["Project Type", "projectType"],
                  ["Revenue", "amount"],
                  ["Permit Issued", "permitIssueDate"],
                  ["Interconnection Status", "interconnectionStatus"],
                  ["RTB Blocked Notes", null],
                  ["Construction Status", "constructionStatus"],
                  ["Line Items", null],
                  ["DA Paid", "daStatus"],
                ] as Array<[string, SortField | null]>
              ).map(([label, field]) =>
                field ? (
                  <th
                    key={label}
                    onClick={() => toggleSort(field)}
                    className="text-left px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                  >
                    {label}{" "}
                    <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
                  </th>
                ) : (
                  <th key={label} className="text-left px-3 py-2 font-medium">
                    {label}
                  </th>
                )
              )}
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={13} className="text-center text-muted py-8">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center text-muted py-8">
                  {items.length === 0
                    ? "No deals awaiting RTB review"
                    : "No deals match the selected filters"}
                </td>
              </tr>
            )}
            {filtered.map((item) => {
              const isPending =
                approveDeal.isPending && approveDeal.variables === item.dealId;
              return (
                <tr
                  key={item.dealId}
                  className="border-t border-t-border hover:bg-surface-2/40 align-top"
                >
                  <td className="px-3 py-2">
                    <a
                      href={getHubSpotDealUrl(item.dealId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-foreground hover:underline"
                    >
                      {item.dealName || item.dealId}
                    </a>
                    {item.driveFolderUrl && (
                      <a
                        href={item.driveFolderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-muted hover:text-foreground hover:underline mt-0.5"
                      >
                        📁 Drive
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.projectManager ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{item.location ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {item.dealStage ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {item.projectType ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {item.amount != null ? CURRENCY.format(item.amount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {formatDate(item.permitIssueDate)}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.interconnectionStatus ?? "—"}</td>
                  <td className="px-3 py-2 text-muted max-w-xs whitespace-pre-wrap">
                    {item.rtbBlockedReason ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.constructionStatus ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">
                    {item.lineItems.length === 0 ? (
                      "—"
                    ) : (
                      <details>
                        <summary className="cursor-pointer whitespace-nowrap hover:text-foreground">
                          {item.lineItems.length} item
                          {item.lineItems.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-xs min-w-48">
                          {item.lineItems.map((li, idx) => (
                            <li key={idx} className="whitespace-nowrap">
                              <span className="text-foreground">{li.quantity}×</span>{" "}
                              {li.name}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.daPaid ? (
                      <span className="text-green-500">✓ Paid</span>
                    ) : (
                      <span className="text-muted">{item.daStatus ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => approveDeal.mutate(item.dealId)}
                      disabled={isPending || item.approved}
                      className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {item.approved
                        ? "Approved"
                        : isPending
                          ? "Approving…"
                          : "Approve — Release to Build"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
