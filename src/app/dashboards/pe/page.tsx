"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DealsTab from "@/components/pe/DealsTab";
import DocsTab from "@/components/pe/DocsTab";
import AnalyticsTab from "@/components/pe/AnalyticsTab";
import MilestonesTab from "@/components/pe/MilestonesTab";

const TABS = [
  { key: "deals", label: "Deals & Payments" },
  { key: "milestones", label: "Milestone Payments" },
  { key: "docs", label: "Documents" },
  { key: "analytics", label: "Analytics" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function PeHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: TabKey =
    raw === "docs" || raw === "analytics" || raw === "milestones" ? raw : "deals";

  const tabsSlot = (
    <div className="flex flex-wrap items-center gap-1.5 mb-5">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => router.replace(`/dashboards/pe?tab=${t.key}`, { scroll: false })}
          className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
            tab === t.key
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
              : "border-t-border text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === "milestones") return <MilestonesTab tabsSlot={tabsSlot} />;
  if (tab === "docs") return <DocsTab tabsSlot={tabsSlot} />;
  if (tab === "analytics") return <AnalyticsTab tabsSlot={tabsSlot} />;
  return <DealsTab tabsSlot={tabsSlot} />;
}

export default function PeHubPage() {
  return (
    <Suspense fallback={null}>
      <PeHub />
    </Suspense>
  );
}
