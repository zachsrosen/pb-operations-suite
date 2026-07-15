"use client";

import { useMemo, useState } from "react";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

export interface SolarEdgeSiteRow {
  siteId: number;
  siteName: string;
  activationStatus: string | null;
  peakPowerKw: number | null;
  city: string | null;
  state: string | null;
  installDate: string | null;
  projNumber: string | null;
  highestAlertImpact: number;
  openAlertCount: number;
  portalUrl: string | null;
}

/** SolarEdge impact 0-9 → chip color + label. */
function impactChip(impact: number): { cls: string; label: string } | null {
  if (impact >= 7) return { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", label: `Impact ${impact}` };
  if (impact >= 4) return { cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", label: `Impact ${impact}` };
  if (impact >= 1) return { cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", label: `Impact ${impact}` };
  return null;
}

function formatInstall(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function SolarEdgeFleetTable({ sites }: { sites: SolarEdgeSiteRow[] }) {
  const [search, setSearch] = useState("");
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [alertSel, setAlertSel] = useState<string[]>([]);

  const statusOptions = useMemo(
    () => [...new Set(sites.map((s) => s.activationStatus).filter(Boolean))].map((s) => ({ value: s as string, label: s as string })),
    [sites]
  );
  const alertOptions = [
    { value: "__any__", label: "Any alert" },
    { value: "__none__", label: "No alerts" },
    { value: "__critical__", label: "Critical (impact ≥7)" },
  ];

  const visible = useMemo(() => {
    let rows = sites;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) => s.siteName?.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q) || s.projNumber?.toLowerCase().includes(q)
      );
    }
    if (statusSel.length) rows = rows.filter((s) => s.activationStatus && statusSel.includes(s.activationStatus));
    if (alertSel.length) {
      rows = rows.filter((s) =>
        alertSel.some((sel) =>
          sel === "__any__" ? s.openAlertCount > 0 : sel === "__none__" ? s.openAlertCount === 0 : s.highestAlertImpact >= 7
        )
      );
    }
    return rows;
  }, [sites, search, statusSel, alertSel]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search customer, PROJ, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm bg-surface border border-t-border text-foreground placeholder:text-muted w-64"
        />
        {statusOptions.length > 1 && (
          <MultiSelectFilter label="Status" options={statusOptions} selected={statusSel} onChange={setStatusSel} accentColor="cyan" />
        )}
        <MultiSelectFilter label="Alerts" options={alertOptions} selected={alertSel} onChange={setAlertSel} accentColor="cyan" />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span>{visible.length === sites.length ? `${sites.length} sites` : `${visible.length} of ${sites.length} sites`}</span>
          <span className="text-red-400">{sites.filter((s) => s.openAlertCount > 0).length} with alerts</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-left text-muted">
              <th className="pb-3 pr-4 font-medium">Customer / Site</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 pr-4 font-medium">Alerts</th>
              <th className="pb-3 pr-4 font-medium">Installed</th>
              <th className="pb-3 pr-4 font-medium">Location</th>
              <th className="pb-3 font-medium">Monitor</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const chip = impactChip(s.highestAlertImpact);
              return (
                <tr key={s.siteId} className="border-b border-t-border hover:bg-surface transition-colors">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-foreground truncate max-w-[280px]">{s.siteName}</div>
                    {s.projNumber && <div className="text-xs text-muted">{s.projNumber}</div>}
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {s.activationStatus === "Active" ? (
                      <span className="text-green-500">✓ Active</span>
                    ) : (
                      <span className="text-muted">{s.activationStatus || "—"}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-1">
                      {chip ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${chip.cls}`}>{chip.label}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {s.openAlertCount > 1 && <span className="text-xs text-muted">×{s.openAlertCount}</span>}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted">{formatInstall(s.installDate)}</td>
                  <td className="py-3 pr-4 text-xs text-muted truncate max-w-[160px]">
                    {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-3 text-xs">
                    {s.portalUrl ? (
                      <a
                        href={s.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-cyan-500 hover:underline"
                        title="Open in SolarEdge Monitoring"
                      >
                        Monitor<span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  {search || statusSel.length || alertSel.length ? "No sites match your filters" : "No sites"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
