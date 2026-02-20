"use client";

import DashboardShell from "@/components/DashboardShell";
import { useExecutiveData } from "@/hooks/useExecutiveData";
import { AnomalyInsights } from "@/components/ui/AnomalyInsights";
import { CapacityHeatmap } from "@/components/ui/CapacityHeatmap";

function StatCard({
  value,
  label,
  variant,
  borderColor,
}: {
  value: string | number;
  label: string;
  variant?: "accent" | "pe" | "danger" | "default";
  borderColor?: string;
}) {
  const variantClasses: Record<string, string> = {
    accent: "border-orange-500 bg-orange-500/10",
    pe: "border-emerald-500 bg-emerald-500/10",
    danger: "border-red-500 bg-red-500/10",
    default: "border-t-border bg-surface",
  };
  const cls = variantClasses[variant || "default"];
  const style = borderColor && !variant ? { borderColor } : undefined;

  return (
    <div className={`rounded-xl border p-4 ${cls}`} style={style}>
      <div className="text-3xl font-bold font-mono">{value}</div>
      <div className="text-[0.7rem] text-muted mt-1">{label}</div>
    </div>
  );
}

export default function AlertsPage() {
  const {
    projects,
    loading,
    error,
    lastUpdated,
    fetchData,
    alerts,
    capacityAnalysis,
    accessChecked,
  } = useExecutiveData("alerts");

  const dangerCount = alerts.filter((a) => a.type === "danger").length;
  const warningCount = alerts.filter((a) => a.type === "warning").length;
  const peRelated = alerts.filter((a) => a.title.includes("PE")).length;

  if (!accessChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted text-lg">Checking access...</div>
      </div>
    );
  }

  return (
    <DashboardShell
      title="Alerts"
      subtitle={`${alerts.length} active alerts`}
      accentColor="red"
      lastUpdated={lastUpdated}
    >
      {loading && projects.length === 0 ? (
        <div className="bg-surface border border-t-border rounded-xl p-8 text-center">
          <div className="text-lg text-muted">Loading alerts...</div>
        </div>
      ) : error && projects.length === 0 ? (
        <div className="bg-surface border border-red-500 rounded-xl p-8 text-center">
          <div className="text-lg">Error loading data</div>
          <div className="text-sm text-muted mt-2">{error}</div>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-orange-500 border-none rounded-md cursor-pointer text-black font-semibold"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Rule-based alert stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard value={dangerCount} label="Critical Alerts" variant="danger" />
            <StatCard value={warningCount} label="Warnings" borderColor="#eab308" />
            <StatCard value={alerts.length} label="Total Alerts" />
            <StatCard value={peRelated} label="PE Related" variant="pe" />
          </div>

          {/* Rule-based alerts */}
          <div className="grid gap-4">
            {alerts.slice(0, 20).map((a, i) => (
              <div
                key={i}
                className={`bg-surface border rounded-lg p-4 ${a.type === "danger" ? "border-red-500" : "border-yellow-500"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xl ${a.type === "danger" ? "text-red-500" : "text-yellow-500"}`}>
                    {a.type === "danger" ? "✕" : "!"}
                  </span>
                  <span className="font-semibold">{a.title}</span>
                </div>
                <div className="text-sm text-muted">{a.message}</div>
                {a.project && (
                  <a
                    href={a.project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[0.7rem] text-blue-500 hover:underline mt-2 inline-block"
                  >
                    View in HubSpot
                  </a>
                )}
              </div>
            ))}
            {alerts.length === 0 && (
              <div className="text-center text-muted text-sm py-8">
                No rule-based alerts at this time.
              </div>
            )}
          </div>

          {/* Capacity Heatmap — predictive 8-week crew utilization */}
          <div className="mt-6">
            <CapacityHeatmap capacityAnalysis={capacityAnalysis} />
          </div>

          {/* AI Insights — on-demand anomaly detection */}
          <div className="mt-6">
            <AnomalyInsights />
          </div>
        </>
      )}
    </DashboardShell>
  );
}
