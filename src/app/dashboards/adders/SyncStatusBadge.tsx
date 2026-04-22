"use client";

// Placeholder sync status. Wires to AdderSyncRun in Chunk 6 when OpenSolar
// sync ships. Today: shows "Local catalog only".
export default function SyncStatusBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-t-border"
      title="OpenSolar sync coming in Chunk 6."
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" />
      Sync: local catalog only
    </span>
  );
}
