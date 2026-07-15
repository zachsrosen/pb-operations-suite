"use client";

import { useMemo, useState } from "react";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { getHubSpotDealUrl, getHubSpotTicketUrl } from "@/lib/external-links";

export interface SolarEdgeTicket {
  id: string;
  subject: string;
}

export interface SolarEdgeNamedAlert {
  alertType: string;
  component: string | null;
  impact: number;
  status: string;
  rmaStatus: string | null;
  rmaCaseNumber: string | null;
}

export interface SolarEdgeSiteRow {
  siteId: number;
  siteName: string;
  activationStatus: string | null;
  peakPowerKw: number | null;
  city: string | null;
  state: string | null;
  installDate: string | null;
  projNumber: string | null;
  dealId: string | null;
  dealName: string | null;
  stageLabel: string | null;
  tickets: SolarEdgeTicket[];
  alerts: SolarEdgeNamedAlert[];
  inverterCount: number;
  optimizerCount: number;
  batteryCount: number;
  hasStorage: boolean;
  highestAlertImpact: number;
  openAlertCount: number;
  portalUrl: string | null;
}

export interface SolarEdgeAlertType {
  alertType: string;
  impact: number;
}

type SortKey = "impact" | "installed" | "customer";

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

/** "PROJ-2166 | Bruer, Kevin | 7556 S Elk Ct…" → "Bruer, Kevin". */
function customerFromDealName(dealName: string | null): string | null {
  if (!dealName) return null;
  const parts = dealName.split("|").map((p) => p.trim());
  return parts[1] || null;
}

/** Compact device summary, e.g. "12 inv · 24 opt · 🔋 2". */
function deviceSummary(s: SolarEdgeSiteRow): string {
  const bits: string[] = [];
  if (s.inverterCount) bits.push(`${s.inverterCount} inv`);
  if (s.optimizerCount) bits.push(`${s.optimizerCount} opt`);
  if (s.batteryCount) bits.push(`🔋 ${s.batteryCount}`);
  else if (s.hasStorage) bits.push("🔋");
  return bits.join(" · ") || "—";
}

export default function SolarEdgeFleetTable({
  sites,
  alertTypes = [],
}: {
  sites: SolarEdgeSiteRow[];
  alertTypes?: SolarEdgeAlertType[];
}) {
  const [search, setSearch] = useState("");
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [alertSel, setAlertSel] = useState<string[]>([]);
  const [typeSel, setTypeSel] = useState<string[]>([]);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "impact", dir: "desc" });

  const statusOptions = useMemo(
    () => [...new Set(sites.map((s) => s.activationStatus).filter(Boolean))].map((s) => ({ value: s as string, label: s as string })),
    [sites]
  );
  const alertOptions = [
    { value: "__any__", label: "Any alert" },
    { value: "__none__", label: "No alerts" },
    { value: "__critical__", label: "Critical (impact ≥7)" },
  ];
  const typeOptions = useMemo(
    () => alertTypes.map((t) => ({ value: t.alertType, label: t.alertType })),
    [alertTypes]
  );

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "customer" ? "asc" : "desc" }));
  }
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const visible = useMemo(() => {
    let rows = sites;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.siteName?.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q) ||
          s.projNumber?.toLowerCase().includes(q) ||
          s.dealName?.toLowerCase().includes(q)
      );
    }
    if (statusSel.length) rows = rows.filter((s) => s.activationStatus && statusSel.includes(s.activationStatus));
    if (alertsOnly) rows = rows.filter((s) => s.openAlertCount > 0);
    if (alertSel.length) {
      rows = rows.filter((s) =>
        alertSel.some((sel) =>
          sel === "__any__" ? s.openAlertCount > 0 : sel === "__none__" ? s.openAlertCount === 0 : s.highestAlertImpact >= 7
        )
      );
    }
    if (typeSel.length) {
      rows = rows.filter((s) => s.alerts.some((a) => typeSel.includes(a.alertType)));
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      if (sort.key === "customer") {
        const an = (customerFromDealName(a.dealName) || a.siteName || "").toLowerCase();
        const bn = (customerFromDealName(b.dealName) || b.siteName || "").toLowerCase();
        return an.localeCompare(bn) * dir;
      }
      if (sort.key === "installed") {
        const at = a.installDate ? new Date(a.installDate).getTime() : 0;
        const bt = b.installDate ? new Date(b.installDate).getTime() : 0;
        return (at - bt) * dir;
      }
      // impact — tiebreak on open-alert count then name for a stable order
      if (a.highestAlertImpact !== b.highestAlertImpact) return (a.highestAlertImpact - b.highestAlertImpact) * dir;
      if (a.openAlertCount !== b.openAlertCount) return (a.openAlertCount - b.openAlertCount) * dir;
      return a.siteName.localeCompare(b.siteName);
    });
    return sorted;
  }, [sites, search, statusSel, alertSel, typeSel, alertsOnly, sort]);

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
        {typeOptions.length > 0 && (
          <MultiSelectFilter label="Alert type" options={typeOptions} selected={typeSel} onChange={setTypeSel} accentColor="cyan" />
        )}
        <button
          type="button"
          onClick={() => setAlertsOnly((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            alertsOnly
              ? "bg-red-500 text-white border-red-500"
              : "bg-surface text-muted border-t-border hover:text-foreground"
          }`}
        >
          Active alerts only
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span>{visible.length === sites.length ? `${sites.length} sites` : `${visible.length} of ${sites.length} sites`}</span>
          <span className="text-red-400">{sites.filter((s) => s.openAlertCount > 0).length} with alerts</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-left text-muted">
              <th className="pb-3 pr-4 font-medium cursor-pointer select-none" onClick={() => toggleSort("customer")}>
                Customer / Site{sortArrow("customer")}
              </th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 pr-4 font-medium cursor-pointer select-none" onClick={() => toggleSort("impact")}>
                Alerts{sortArrow("impact")}
              </th>
              <th className="pb-3 pr-4 font-medium">Tickets</th>
              <th className="pb-3 pr-4 font-medium">Devices</th>
              <th className="pb-3 pr-4 font-medium cursor-pointer select-none" onClick={() => toggleSort("installed")}>
                Installed{sortArrow("installed")}
              </th>
              <th className="pb-3 pr-4 font-medium">Location</th>
              <th className="pb-3 font-medium">Monitor</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const chip = impactChip(s.highestAlertImpact);
              const customer = customerFromDealName(s.dealName);
              return (
                <tr key={s.siteId} className="border-b border-t-border hover:bg-surface transition-colors">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-foreground truncate max-w-[280px]">{customer || s.siteName}</div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {s.projNumber && <span>{s.projNumber}</span>}
                      {s.dealId && (
                        <a
                          href={getHubSpotDealUrl(s.dealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-500 hover:underline"
                          title={s.dealName || "Open deal in HubSpot"}
                        >
                          Deal ↗
                        </a>
                      )}
                    </div>
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
                    {s.alerts.length > 0 && (
                      <div className="mt-1 flex flex-col gap-0.5">
                        {s.alerts.slice(0, 4).map((a, i) => (
                          <span
                            key={`${a.alertType}-${a.component ?? ""}-${i}`}
                            className="text-xs text-muted truncate max-w-[220px]"
                            title={[a.alertType, a.component, a.rmaStatus && `RMA: ${a.rmaStatus}`].filter(Boolean).join(" · ")}
                          >
                            {a.alertType}
                            {a.component ? <span className="text-muted/70"> · {a.component}</span> : null}
                          </span>
                        ))}
                        {s.alerts.length > 4 && <span className="text-xs text-muted/70">+{s.alerts.length - 4} more</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {s.tickets.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {s.tickets.map((t) => (
                          <a
                            key={t.id}
                            href={getHubSpotTicketUrl(t.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-500 hover:underline truncate max-w-[180px]"
                            title={t.subject}
                          >
                            🎫 {t.subject}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">{deviceSummary(s)}</td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">{formatInstall(s.installDate)}</td>
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
                <td colSpan={8} className="py-8 text-center text-muted">
                  {search || statusSel.length || alertSel.length || typeSel.length || alertsOnly
                    ? "No sites match your filters"
                    : "No sites"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
