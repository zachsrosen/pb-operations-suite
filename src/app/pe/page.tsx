"use client";

import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard, ProjectTable } from "@/components/ui";

export default function PEPage() {
  const { projects, loading, error, lastUpdated } = useProjects({
    context: "pe",
    includeStats: false,
  });

  const peStats = useMemo(() => {
    const totalValue = projects.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Milestone categorization
    const milestone1Complete = projects.filter(
      (p) => p.inspectionPassDate || ["Permission To Operate", "Close Out", "Project Complete"].includes(p.stage)
    );
    const milestone2Complete = projects.filter(
      (p) => p.ptoGrantedDate || ["Close Out", "Project Complete"].includes(p.stage)
    );
    const pendingInspection = projects.filter(
      (p) => !p.inspectionPassDate && !["Permission To Operate", "Close Out", "Project Complete"].includes(p.stage)
    );
    const inConstruction = projects.filter((p) => p.stage === "Construction");
    const inRtb = projects.filter((p) => p.isRtb);

    // Status distribution
    const byStatus = projects.reduce((acc, p) => {
      const status = p.participateEnergyStatus || "Unknown";
      if (!acc[status]) acc[status] = { count: 0, value: 0 };
      acc[status].count++;
      acc[status].value += p.amount || 0;
      return acc;
    }, {} as Record<string, { count: number; value: number }>);

    return {
      total: projects.length,
      totalValue,
      milestone1Complete,
      milestone2Complete,
      pendingInspection,
      inConstruction,
      inRtb,
      byStatus,
    };
  }, [projects]);

  const exportPEReport = (format: "csv" | "clipboard") => {
    const headers = [
      "Project Name",
      "Location",
      "Stage",
      "Value",
      "PE Status",
      "Close Date",
      "Forecasted Install",
      "Forecasted Inspection",
      "Forecasted PTO",
      "Inspection Pass Date",
      "PTO Granted Date",
    ];
    const rows = projects.map((p) => [
      p.name,
      p.pbLocation,
      p.stage,
      p.amount,
      p.participateEnergyStatus || "",
      p.closeDate || "",
      p.forecastedInstallDate || "",
      p.forecastedInspectionDate || "",
      p.forecastedPtoDate || "",
      p.inspectionPassDate || "",
      p.ptoGrantedDate || "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");

    if (format === "clipboard") {
      navigator.clipboard.writeText(csvContent);
      alert("Copied to clipboard!");
    } else {
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pe-report-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Participate Energy Dashboard"
        subtitle="PE project tracking with milestone status and compliance monitoring"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <StatCard
            label="Total PE Projects"
            value={peStats.total}
            color="emerald"
            loading={loading}
          />
          <StatCard
            label="PE Pipeline Value"
            value={`$${(peStats.totalValue / 1000000).toFixed(2)}M`}
            color="green"
            loading={loading}
          />
          <StatCard
            label="Milestone 1 Complete"
            value={peStats.milestone1Complete.length}
            subValue="Inspection passed"
            loading={loading}
          />
          <StatCard
            label="Milestone 2 Complete"
            value={peStats.milestone2Complete.length}
            subValue="PTO granted"
            loading={loading}
          />
          <StatCard
            label="In Construction"
            value={peStats.inConstruction.length}
            color="blue"
            loading={loading}
          />
        </div>

        {/* Export Panel */}
        <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-6 mb-8">
          <h3 className="text-sm font-semibold text-emerald-400 mb-2">Export for Participate Energy</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Generate reports with all milestone dates and forecasts for PE submission
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => exportPEReport("csv")}
              className="flex-1 py-3 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 transition-colors"
            >
              Download CSV
            </button>
            <button
              onClick={() => exportPEReport("clipboard")}
              className="flex-1 py-3 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 transition-colors"
            >
              Copy to Clipboard
            </button>
          </div>
        </div>

        {/* Milestone Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Pending Inspection */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-orange-400 mb-4">
              Pending Inspection ({peStats.pendingInspection.length})
            </h3>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {peStats.pendingInspection.length === 0 ? (
                <p className="text-sm text-zinc-500">No projects pending</p>
              ) : (
                peStats.pendingInspection.map((p) => (
                  <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                    <div>
                      <div className="text-sm text-white">{p.name}</div>
                      <div className="text-xs text-zinc-500">{p.pbLocation} - {p.stage}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs stat-number text-orange-400">
                        ${((p.amount || 0) / 1000).toFixed(0)}k
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Milestone 1 Complete */}
          <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-emerald-400 mb-4">
              Milestone 1 Complete ({peStats.milestone1Complete.length})
            </h3>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {peStats.milestone1Complete.length === 0 ? (
                <p className="text-sm text-zinc-500">No projects at this milestone</p>
              ) : (
                peStats.milestone1Complete.map((p) => (
                  <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                    <div>
                      <div className="text-sm text-white">{p.name}</div>
                      <div className="text-xs text-zinc-500">
                        {p.pbLocation} - Passed {p.inspectionPassDate || "N/A"}
                      </div>
                    </div>
                    <span className="badge badge-success">Inspection</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Full PE Projects Table */}
        <h2 className="text-lg font-semibold mb-4">All PE Projects</h2>
        <ProjectTable
          projects={projects}
          loading={loading}
          columns={["index", "name", "location", "stage", "value", "install", "inspection", "pto", "actions"]}
        />
      </main>
    </div>
  );
}
