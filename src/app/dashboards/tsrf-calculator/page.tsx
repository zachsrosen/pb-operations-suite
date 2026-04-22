"use client";

import DashboardShell from "@/components/DashboardShell";

export default function TsrfCalculatorPage() {
  return (
    <DashboardShell title="TSRF Solar Peak Power Calculator" accentColor="orange" fullWidth>
      <div
        className="-mx-4 sm:-mx-6 -mb-6"
        style={{ height: "calc(100vh - 120px)" }}
      >
        <iframe
          src="/tsrf-calculator.html"
          className="w-full h-full border-none"
          title="TSRF Solar Peak Power Calculator"
          allow="clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </DashboardShell>
  );
}
