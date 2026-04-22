"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

type SyncRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRunStatus;
  addersPushed: number;
  addersFailed: number;
};

type StatusPayload = {
  lastRun: SyncRun | null;
  lastSuccess: SyncRun | null;
};

async function fetchStatus(): Promise<StatusPayload> {
  const r = await fetch("/api/adders/sync/status");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function formatAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const deltaMs = Date.now() - t;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function classify(lastRun: SyncRun | null, lastSuccess: SyncRun | null): {
  tone: "green" | "amber" | "red" | "muted";
  label: string;
  title: string;
} {
  if (!lastRun) {
    return {
      tone: "muted",
      label: "Sync: never run",
      title: "No sync runs recorded yet.",
    };
  }
  if (lastRun.status === "FAILED") {
    return {
      tone: "red",
      label: "Sync failed",
      title: `Last run at ${new Date(lastRun.startedAt).toLocaleString()} failed with ${lastRun.addersFailed} error(s).`,
    };
  }
  if (lastRun.status === "RUNNING") {
    return {
      tone: "amber",
      label: "Sync running",
      title: `Started ${formatAgo(lastRun.startedAt)}.`,
    };
  }
  // SUCCESS or PARTIAL
  const reference = lastSuccess ?? lastRun;
  const ageH = (Date.now() - new Date(reference.startedAt).getTime()) / 3_600_000;
  if (ageH <= 24) {
    return {
      tone: "green",
      label: `Synced ${formatAgo(reference.startedAt)}`,
      title: `${reference.addersPushed} adders synced. Status: ${reference.status}.`,
    };
  }
  return {
    tone: "amber",
    label: `Last sync ${formatAgo(reference.startedAt)}`,
    title: `Last successful sync is >24h old. Status: ${reference.status}.`,
  };
}

const TONE_CLASSES: Record<string, string> = {
  green: "bg-green-500/15 text-green-600 ring-green-500/30",
  amber: "bg-amber-500/15 text-amber-600 ring-amber-500/30",
  red: "bg-red-500/15 text-red-600 ring-red-500/30",
  muted: "bg-surface-2 text-muted ring-t-border",
};

const DOT_CLASSES: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  muted: "bg-zinc-400",
};

export default function SyncStatusBadge() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const canManage = useMemo(() => {
    const roles = session?.user?.roles ?? [];
    return roles.includes("ADMIN") || roles.includes("OWNER");
  }, [session?.user?.roles]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["adder-sync-status"],
    queryFn: fetchStatus,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  async function triggerSync() {
    try {
      const r = await fetch("/api/adders/sync", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("sync trigger failed", err);
    } finally {
      await qc.invalidateQueries({ queryKey: ["adder-sync-status"] });
    }
  }

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-t-border">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" />
        Sync: loading…
      </span>
    );
  }

  if (isError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-red-500/30">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        Sync: status unavailable
      </span>
    );
  }

  const { tone, label, title } = classify(data?.lastRun ?? null, data?.lastSuccess ?? null);

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${TONE_CLASSES[tone]}`}
        title={title}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
        {label}
      </span>
      {canManage && (
        <button
          type="button"
          onClick={triggerSync}
          className="rounded-md border border-t-border bg-surface px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
          title="Manually trigger a sync run."
        >
          Sync now
        </button>
      )}
    </span>
  );
}
