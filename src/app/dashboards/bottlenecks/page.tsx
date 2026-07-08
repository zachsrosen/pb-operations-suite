"use client";

import { Suspense } from "react";
import DashboardShell from "@/components/DashboardShell";
import BottleneckView from "@/components/bottlenecks/BottleneckView";

export default function BottlenecksPage() {
  return (
    <DashboardShell title="Bottleneck Monitor" accentColor="red">
      {/* Suspense: BottleneckView reads useSearchParams (view/loc presets). */}
      <Suspense fallback={<div className="p-8 text-center text-muted">Loading…</div>}>
        <BottleneckView />
      </Suspense>
    </DashboardShell>
  );
}
