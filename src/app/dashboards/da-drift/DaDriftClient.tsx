"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface DriftRow {
  id: string;
  pandaDocId: string;
  hubspotDealId: string;
  templateId: string | null;
  documentName: string | null;
  pandaDocStatus: string;
  expectedHubspot: string;
  actualHubspot: string | null;
  pandaDocSentAt: string | null;
  pandaDocCompleted: string | null;
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

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const prettyPdStatus = (s: string) => s.replace(/^document\./, "");

export default function DaDriftClient({ initialRows, currentFilter, counts }: Props) {
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
      const res = await fetch("/api/da-drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json()) as { row?: DriftRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.row) {
        setRows((prev) =>
          prev.map((r) => (r.id === data.row!.id ? data.row! : r)).filter((r) => {
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

  const pdUrl = (id: string) => `https://app.pandadoc.com/a/#/documents/${id}`;

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-t-border rounded-lg p-4 text-sm text-muted">
        <p>
          Backup detector for the HubSpot↔PandaDoc native connector. Each row is a
          DA where PandaDoc&apos;s status disagrees with the deal&apos;s
          <code className="mx-1 px-1 py-0.5 bg-surface-2 rounded">layout_status</code>
          property. Open the deal in HubSpot, fix the property manually, then mark
          this row Resolved.
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
                  ? "bg-orange-500/15 text-orange-400 border-orange-500/40"
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
                  <th className="text-left px-3 py-2 font-medium">Document</th>
                  <th className="text-left px-3 py-2 font-medium">PandaDoc</th>
                  <th className="text-left px-3 py-2 font-medium">Expected</th>
                  <th className="text-left px-3 py-2 font-medium">Actual (HubSpot)</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-t-border hover:bg-surface-2/50">
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {fmtDate(r.detectedAt)}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <div className="truncate text-foreground" title={r.documentName ?? r.pandaDocId}>
                        {r.documentName ?? r.pandaDocId}
                      </div>
                      <div className="text-xs text-muted flex gap-2">
                        <a
                          href={pdUrl(r.pandaDocId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          PandaDoc ↗
                        </a>
                        <a
                          href={dealUrl(r.hubspotDealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          Deal {r.hubspotDealId} ↗
                        </a>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      {prettyPdStatus(r.pandaDocStatus)}
                    </td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      {r.expectedHubspot}
                    </td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      {r.actualHubspot ?? <span className="text-muted">(empty)</span>}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
