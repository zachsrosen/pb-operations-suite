"use client";

import { useState } from "react";
import ActivityFeed from "./ActivityFeed";
import CommunicationsFeed from "./CommunicationsFeed";

interface DealActivityPanelProps {
  dealId: string;
}

type Tab = "activity" | "communications";

export default function DealActivityPanel({ dealId }: DealActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("activity");

  return (
    <div className="mt-4 rounded-xl border border-t-border bg-surface print:hidden">
      {/* Tab bar */}
      <div className="flex border-b border-t-border">
        <TabButton
          label="Activity"
          active={activeTab === "activity"}
          onClick={() => setActiveTab("activity")}
        />
        <TabButton
          label="Communications"
          active={activeTab === "communications"}
          onClick={() => setActiveTab("communications")}
        />
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === "activity" && <ActivityFeed dealId={dealId} />}
        {activeTab === "communications" && <CommunicationsFeed dealId={dealId} />}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-medium transition-colors ${
        active
          ? "border-b-2 border-orange-500 text-foreground"
          : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
