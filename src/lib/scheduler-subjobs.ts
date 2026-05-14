// src/lib/scheduler-subjobs.ts
import type { SystemType } from "./zuper-construction";
import { categoryToSystemType } from "./zuper-construction";
import * as Sentry from "@sentry/nextjs";

export type SubJobInfo = {
  systemType: SystemType;
  jobUid: string;
  status: string;
  scheduledDate?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
};

export type JobMatchForSubJobs = {
  jobUid: string;
  status: string;
  statusScore: number;
  addressScore: number;
  categoryName: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
};

export const SYSTEM_ORDER: SystemType[] = ["solar", "battery", "ev", "legacy"];

export const SYSTEM_TAGS: Record<SystemType, string> = {
  solar: "PV",
  battery: "ESS",
  ev: "EV",
  legacy: "CONST",
};

export const SYSTEM_TAG_CLASSES: Record<SystemType, string> = {
  solar: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  battery: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  ev: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  legacy: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
};

export function zuperStatusToTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (s.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s.includes("progress") || s.includes("started")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (s.includes("tentative")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (s.includes("ready")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (s.includes("hold")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (s.includes("unscheduled") || s.includes("new") || s.includes("created") || s.includes("unassigned"))
    return "bg-zinc-500/20 text-zinc-300 border-zinc-500/30";
  return "bg-zinc-500/20 text-muted border-muted/30";
}

export function extractSubJobsFromCandidates(
  dedupedCandidates: JobMatchForSubJobs[],
  projectId: string,
): SubJobInfo[] {
  const bySystem = new Map<string, JobMatchForSubJobs[]>();
  for (const c of dedupedCandidates) {
    const sys = categoryToSystemType(c.categoryName);
    const existing = bySystem.get(sys) ?? [];
    existing.push(c);
    bySystem.set(sys, existing);
  }

  const subJobs: SubJobInfo[] = [];
  for (const [sys, group] of bySystem) {
    group.sort((a, b) => (b.statusScore - a.statusScore) || (b.addressScore - a.addressScore));
    const winner = group[0];

    subJobs.push({
      systemType: sys as SubJobInfo["systemType"],
      jobUid: winner.jobUid,
      status: winner.status || "UNKNOWN",
      scheduledDate: winner.scheduledStart,
      scheduledEnd: winner.scheduledEnd,
      scheduledDays: winner.scheduledDays,
      assignedTo: winner.assignedTo,
    });

    if (group.length > 1) {
      Sentry.addBreadcrumb({
        category: "zuper-lookup",
        message: `Multiple ${sys} jobs matched deal ${projectId}; picked ${winner.jobUid}`,
        level: "warning",
      });
    }
  }

  subJobs.sort((a, b) => SYSTEM_ORDER.indexOf(a.systemType) - SYSTEM_ORDER.indexOf(b.systemType));

  // If typed sub-jobs exist (solar/battery/ev), the legacy parent is redundant — drop it
  const hasTyped = subJobs.some((s) => s.systemType !== "legacy");
  return hasTyped ? subJobs.filter((s) => s.systemType !== "legacy") : subJobs;
}
