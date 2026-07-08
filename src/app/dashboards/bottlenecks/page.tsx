"use client";

import DashboardShell from "@/components/DashboardShell";
import BottleneckView from "@/components/bottlenecks/BottleneckView";

export default function BottlenecksPage() {
  return (
    <DashboardShell title="Bottleneck Monitor" accentColor="red">
      <BottleneckView />
    </DashboardShell>
  );
}
