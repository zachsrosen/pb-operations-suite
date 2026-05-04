"use client";

import { Suspense } from "react";
import { BomDashboardInner, SERVICE_PIPELINE_CONFIG } from "@/app/dashboards/bom/page";

export default function ServiceBomDashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-muted text-sm">Loading…</div>}>
      <BomDashboardInner pipelineConfig={SERVICE_PIPELINE_CONFIG} />
    </Suspense>
  );
}
