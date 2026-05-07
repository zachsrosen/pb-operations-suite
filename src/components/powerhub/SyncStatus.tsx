"use client";

interface SyncStatusProps {
  lastAssetSync: string | null;
  lastTelemetryPoll: string | null;
  lastAlertPoll: string | null;
  onForceSync: (type: "assets" | "telemetry" | "alerts") => void;
  syncing: boolean;
}

export default function SyncStatus({
  lastAssetSync,
  lastTelemetryPoll,
  lastAlertPoll,
  onForceSync,
  syncing,
}: SyncStatusProps) {
  return (
    <div className="bg-surface rounded-xl p-4 shadow-card mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Sync Status</h3>
        <button
          onClick={() => onForceSync("assets")}
          disabled={syncing}
          className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing..." : "Force Sync All"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <SyncItem label="Assets" timestamp={lastAssetSync} />
        <SyncItem label="Telemetry" timestamp={lastTelemetryPoll} />
        <SyncItem label="Alerts" timestamp={lastAlertPoll} />
      </div>
    </div>
  );
}

function SyncItem({ label, timestamp }: { label: string; timestamp: string | null }) {
  const ago = timestamp ? formatRelativeTime(new Date(timestamp)) : "Never";
  const isRecent = timestamp && Date.now() - new Date(timestamp).getTime() < 30 * 60 * 1000;

  return (
    <div>
      <div className="text-muted text-xs">{label}</div>
      <div className={`font-medium ${isRecent ? "text-green-500" : "text-yellow-500"}`}>
        {ago} {isRecent ? "✓" : "⚠"}
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
