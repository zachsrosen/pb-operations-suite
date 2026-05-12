"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type DriftType =
  | "STATUS"
  | "FAIL_DISAGREEMENT"
  | "COMPLETION_DATE"
  | "INSPECTION_PASS_DATE"
  | "INSPECTION_FAIL_DATE"
  | "ROLLUP_MISMATCH";

interface DriftRow {
  id: string;
  zuperJobUid: string;
  hubspotDealId: string | null;
  projectNumber: string | null;
  dealName: string | null;
  pbLocation: string | null;
  category: string;
  zuperJobTitle: string | null;
  zuperStatus: string;
  hubspotStatus: string | null;
  driftTypes: DriftType[];
  zuperCompletedAt: string | null;
  hubspotCompletionAt: string | null;
  zuperFailedAt: string | null;
  hubspotFailAt: string | null;
  detectedAt: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolveNote: string | null;
}

type Filter = "OPEN" | "RESOLVED" | "IGNORED" | "all";

interface Props {
  initialRows: DriftRow[];
  currentFilter: Filter;
  counts: { open: number; resolved: number; ignored: number };
}

const HUBSPOT_PORTAL = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "7086286";

const statusBadge = (s: DriftRow["status"]) => {
  const map = {
    OPEN: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Open" },
    RESOLVED: { bg: "bg-green-500/15", text: "text-green-400", label: "Resolved" },
    IGNORED: { bg: "bg-zinc-500/15", text: "text-muted", label: "Ignored" },
  } as const;
  const m = map[s];
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
};

const CATEGORY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  site_survey: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Survey" },
  construction: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Construction" },
  solar_install: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Solar" },
  battery_install: { bg: "bg-green-500/15", text: "text-green-400", label: "Battery" },
  ev_install: { bg: "bg-cyan-500/15", text: "text-cyan-400", label: "EV" },
  inspection: { bg: "bg-purple-500/15", text: "text-purple-400", label: "Inspection" },
  construction_rollup: { bg: "bg-pink-500/15", text: "text-pink-400", label: "Rollup" },
};

const categoryBadge = (category: string) => {
  const m = CATEGORY_BADGE[category] ?? {
    bg: "bg-zinc-500/15",
    text: "text-muted",
    label: category,
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
};

const DRIFT_LABEL: Record<DriftType, string> = {
  STATUS: "Status",
  FAIL_DISAGREEMENT: "Fail/Pass",
  COMPLETION_DATE: "Completion Date",
  INSPECTION_PASS_DATE: "Inspection Pass Date",
  INSPECTION_FAIL_DATE: "Inspection Fail Date",
  ROLLUP_MISMATCH: "Rollup",
};

const driftChip = (t: DriftType) => (
  <span
    key={t}
    className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded bg-red-500/10 text-red-400 border border-red-500/30 mr-1 mb-1"
  >
    {DRIFT_LABEL[t] ?? t}
  </span>
);

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const fmtDay = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export default function ZuperDriftClient({ initialRows, currentFilter, counts }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const setFilter = (f: Filter) => {
    const url = new URL(window.location.href);
    if (f === "OPEN") url.searchParams.delete("status");
    else url.searchParams.set("status", f);
    startTransition(() => router.push(url.pathname + url.search));
  };

  const act = async (id: string, action: "resolve" | "ignore" | "reopen") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/zuper-drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json()) as { row?: DriftRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.row) {
        setRows((prev) =>
          prev
            .map((r) => (r.id === data.row!.id ? data.row! : r))
            .filter((r) => {
              if (currentFilter === "all") return true;
              return r.status === currentFilter;
            }),
        );
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const dealUrl = (dealId: string) =>
    `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL}/deal/${dealId}`;

  const zuperUrl = (jobUid: string) =>
    `https://web.zuperpro.com/jobs/${jobUid}/details`;

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-t-border rounded-lg p-4 text-sm text-muted">
        <p>
          Backup detector for the HubSpot↔Zuper sync. Each row is a Zuper job
          whose status, completion date, or inspection result doesn&apos;t
          match the deal in HubSpot. Open the deal or job, fix the mismatch
          (usually in HubSpot for status drift, sometimes in Zuper for
          construction sub-type drift), then mark this row Resolved.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["OPEN", "RESOLVED", "IGNORED", "all"] as Filter[]).map((f) => {
          const active = currentFilter === f;
          const count =
            f === "OPEN" ? counts.open : f === "RESOLVED" ? counts.resolved : f === "IGNORED" ? counts.ignored : null;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                active
                  ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                  : "bg-surface text-foreground border-t-border hover:bg-surface-2"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
              {count !== null && (
                <span className="ml-2 text-xs text-muted">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-400 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-muted">No drift records.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Detected</th>
                  <th className="text-left px-3 py-2 font-medium">Project / Deal</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-left px-3 py-2 font-medium">Drift</th>
                  <th className="text-left px-3 py-2 font-medium">Zuper</th>
                  <th className="text-left px-3 py-2 font-medium">HubSpot</th>
                  <th className="text-left px-3 py-2 font-medium">Date Δ</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const completionDeltaDays = daysBetween(
                    r.zuperCompletedAt,
                    r.hubspotCompletionAt,
                  );
                  const failDeltaDays = daysBetween(r.zuperFailedAt, r.hubspotFailAt);
                  const deltaDays = failDeltaDays ?? completionDeltaDays;
                  return (
                    <tr key={r.id} className="border-t border-t-border hover:bg-surface-2/50 align-top">
                      <td className="px-3 py-2 text-muted whitespace-nowrap">
                        {fmtDate(r.detectedAt)}
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        <div className="truncate text-foreground" title={r.dealName ?? r.zuperJobTitle ?? r.zuperJobUid}>
                          {r.projectNumber ? (
                            <span className="font-medium">{r.projectNumber} </span>
                          ) : null}
                          {r.dealName ?? r.zuperJobTitle ?? r.zuperJobUid}
                        </div>
                        <div className="text-xs text-muted flex gap-2 mt-0.5">
                          {r.hubspotDealId && (
                            <a
                              href={dealUrl(r.hubspotDealId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              Deal ↗
                            </a>
                          )}
                          {!r.zuperJobUid.startsWith("rollup-construction:") && (
                            <a
                              href={zuperUrl(r.zuperJobUid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              Zuper job ↗
                            </a>
                          )}
                          {r.pbLocation && <span>· {r.pbLocation}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {categoryBadge(r.category)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap">
                          {r.driftTypes.map((t) => driftChip(t))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        <div>{r.zuperStatus}</div>
                        {(r.zuperCompletedAt || r.zuperFailedAt) && (
                          <div className="text-xs text-muted">
                            {fmtDay(r.zuperFailedAt ?? r.zuperCompletedAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        <div>{r.hubspotStatus ?? <span className="text-muted">(empty)</span>}</div>
                        {(r.hubspotCompletionAt || r.hubspotFailAt) && (
                          <div className="text-xs text-muted">
                            {fmtDay(r.hubspotFailAt ?? r.hubspotCompletionAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">
                        {deltaDays !== null ? (
                          <span className={deltaDays > 1 ? "text-amber-400" : "text-muted"}>
                            {deltaDays}d
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{statusBadge(r.status)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.status === "OPEN" ? (
                          <div className="flex justify-end gap-2">
                            <button
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, "resolve")}
                              className="px-2 py-1 text-xs rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50"
                            >
                              Resolved
                            </button>
                            <button
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, "ignore")}
                              className="px-2 py-1 text-xs rounded bg-zinc-500/15 text-muted hover:bg-zinc-500/25 disabled:opacity-50"
                            >
                              Ignore
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={busyId === r.id}
                            onClick={() => act(r.id, "reopen")}
                            className="px-2 py-1 text-xs rounded bg-surface-2 text-foreground hover:bg-surface-elevated disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
