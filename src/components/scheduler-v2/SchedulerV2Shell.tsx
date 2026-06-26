"use client";

import DashboardShell from "@/components/DashboardShell";

export default function SchedulerV2Shell() {
  return (
    <DashboardShell title="Dispatch Board" accentColor="blue" fullWidth>
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <h2 className="text-xl font-semibold text-foreground">
          Scheduler v2 — coming online
        </h2>
        <p className="text-sm text-muted">
          Crew-row dispatch board. Phase 1 scaffolding active; full feature in progress.
        </p>
      </div>
    </DashboardShell>
  );
}
