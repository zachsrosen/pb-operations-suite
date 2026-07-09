"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
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

  const pmOptions = useMemo(
    () => optionsFrom(items, (i) => i.projectManager),
    [items]
  );
  const locationOptions = useMemo(
    () => optionsFrom(items, (i) => i.location),
    [items]
  );

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        const pmOk =
          selectedPMs.length === 0 ||
          (i.projectManager != null && selectedPMs.includes(i.projectManager));
        const locOk =
          selectedLocations.length === 0 ||
          (i.location != null && selectedLocations.includes(i.location));
        return pmOk && locOk;
      }),
    [items, selectedPMs, selectedLocations]
  );

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
              <th className="text-left px-3 py-2 font-medium">Deal</th>
              <th className="text-left px-3 py-2 font-medium">Project Manager</th>
              <th className="text-left px-3 py-2 font-medium">Location</th>
              <th className="text-left px-3 py-2 font-medium">Deal Stage</th>
              <th className="text-left px-3 py-2 font-medium">Permit Issued</th>
              <th className="text-left px-3 py-2 font-medium">Permitting Status</th>
              <th className="text-left px-3 py-2 font-medium">Design Status</th>
              <th className="text-left px-3 py-2 font-medium">Revisions</th>
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="text-center text-muted py-8">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted py-8">
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
                  <td className="px-3 py-2 font-semibold text-foreground">
                    {item.dealName || item.dealId}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.projectManager ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{item.location ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {item.dealStage ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {formatDate(item.permitIssueDate)}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.permittingStatus ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{item.designStatus ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{item.revisionCount ?? "—"}</td>
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
