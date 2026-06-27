"use client";

import DashboardShell from "@/components/DashboardShell";
import { DispatchBoard } from "./DispatchBoard";

export default function SchedulerV2Shell() {
  return (
    <DashboardShell title="Dispatch Board" accentColor="blue" fullWidth>
      <DispatchBoard />
    </DashboardShell>
  );
}
