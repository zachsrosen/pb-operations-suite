"use client";

interface KpiItem {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface CommsKpiCardsProps {
  analytics?: {
    unreadGmail?: number;
    unreadHubspot?: number;
    unreadChat?: number;
    mentionCount?: number;
    taskCount?: number;
    commentCount?: number;
    stageChangeCount?: number;
    starredCount?: number;
    unreadCount?: number;
  };
  activeFilter: string | null;
  onFilterToggle: (key: string) => void;
}

export default function CommsKpiCards({
  analytics,
  activeFilter,
  onFilterToggle,
}: CommsKpiCardsProps) {
  const cards: KpiItem[] = [
    { key: "gmail", label: "Gmail Unread", value: analytics?.unreadGmail ?? 0, color: "#ea4335" },
    { key: "hubspot", label: "HubSpot Unread", value: analytics?.unreadHubspot ?? 0, color: "#ff7a59" },
    { key: "chat", label: "Chat Unread", value: analytics?.unreadChat ?? 0, color: "#0f9d58" },
    { key: "starred", label: "Starred", value: analytics?.starredCount ?? 0, color: "#f59e0b" },
    { key: "mentions", label: "@Mentions", value: analytics?.mentionCount ?? 0, color: "#7c3aed" },
    { key: "tasks", label: "Tasks", value: analytics?.taskCount ?? 0, color: "#2563eb" },
    { key: "comments", label: "Comments", value: analytics?.commentCount ?? 0, color: "#d97706" },
    { key: "stage", label: "Stage Changes", value: analytics?.stageChangeCount ?? 0, color: "#059669" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-4 lg:grid-cols-8 mb-4">
      {cards.map((card) => {
        const isActive = activeFilter === card.key;
        return (
          <button
            key={card.key}
            onClick={() => onFilterToggle(card.key)}
            className={`group relative flex flex-col items-center justify-center rounded-xl px-2 py-3 text-center transition-all duration-150 ${
              isActive
                ? "bg-surface-elevated ring-2 shadow-lg scale-[1.02]"
                : "bg-surface/60 hover:bg-surface hover:shadow-md hover:-translate-y-0.5"
            }`}
            style={{
              ...(isActive
                ? {
                    boxShadow: `0 0 0 2px ${card.color}30`,
                    outline: `2px solid ${card.color}`,
                    outlineOffset: "-2px",
                  }
                : {}),
            }}
          >
            <div
              className="text-2xl font-bold tabular-nums leading-none mb-1"
              style={{ color: card.color }}
            >
              {card.value}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 leading-tight">
              {card.label}
            </div>
            {isActive && (
              <div
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                style={{ background: card.color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
