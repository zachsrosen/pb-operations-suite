/**
 * Auto-advance PE rejection status → "Ready to Resubmit" once a deal's rejection
 * tasks are all done.
 *
 * HubSpot workflows can't re-enroll on tasks or trigger on "all associated tasks
 * complete", so this runs as a poller (cron/pe-rejection-advance). When a deal's
 * M1 (or M2) rejection tasks are all completed — and at least one existed — the
 * milestone status flips from "Rejected" to "Ready to Resubmit".
 *
 * Signal is TASK completion only (not doc status): docs stay action_required
 * until the actual resubmission, which happens AFTER Ready to Resubmit — so a
 * doc-status gate would never be satisfiable at this stage.
 */
import { hubspotClient } from "@/lib/hubspot";

const REJECTED = "Rejected";
const READY = "Ready to Resubmit";
const OPEN_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "WAITING"]);

export interface RejectionTask {
  subject: string;
  status: string;
}

/**
 * Which milestone a PE rejection task belongs to, or null.
 *
 * Matches on the two signals a rejection task must carry, so the task subjects
 * stay freely renameable (e.g. "Sales M1 Rejection", "M1 Rejected by Participate
 * Energy #1 - ZRS", "Compliance M2 Rejection") without code changes:
 *   1. a rejection word — reject / rejected / rejection
 *   2. a standalone milestone token — M1 or M2
 * Onboarding-rejection tasks have no M1/M2 token, so they stay excluded; tasks
 * with no rejection word (e.g. "M1 Ready to Resubmit") don't match either.
 */
export function rejectionTaskMilestone(subject: string): "m1" | "m2" | null {
  if (!/reject(ed|ion)?/i.test(subject)) return null;
  if (/\bM1\b/i.test(subject)) return "m1";
  if (/\bM2\b/i.test(subject)) return "m2";
  return null;
}

export function isOpenTask(status: string): boolean {
  return OPEN_STATUSES.has(status);
}
export function isCompletedTask(status: string): boolean {
  return status === "COMPLETED";
}

/**
 * Decide which milestone statuses to advance. A milestone advances to
 * "Ready to Resubmit" only when its status is currently "Rejected", it has at
 * least one rejection task, and none of those tasks are still open.
 */
export function advanceDecision(input: {
  m1Status: string;
  m2Status: string;
  tasks: RejectionTask[];
}): { pe_m1_status?: string; pe_m2_status?: string } {
  const out: { pe_m1_status?: string; pe_m2_status?: string } = {};
  for (const ms of ["m1", "m2"] as const) {
    const status = ms === "m1" ? input.m1Status : input.m2Status;
    if (status !== REJECTED) continue;
    const msTasks = input.tasks.filter((t) => rejectionTaskMilestone(t.subject) === ms);
    if (msTasks.length === 0) continue; // guard: never had tasks → don't flip
    const anyOpen = msTasks.some((t) => isOpenTask(t.status));
    const anyCompleted = msTasks.some((t) => isCompletedTask(t.status));
    if (!anyOpen && anyCompleted) {
      out[ms === "m1" ? "pe_m1_status" : "pe_m2_status"] = READY;
    }
  }
  return out;
}

export interface AdvanceResult {
  scanned: number;
  advanced: { dealId: string; dealName: string; changes: Record<string, string> }[];
}

// --- Durable ledger ---------------------------------------------------------
// HubSpot's own history is the system of record per deal, but Zach wants a
// running tally of every status this poller auto-advances. We keep it in a
// single SystemConfig row so the count survives Vercel's log retention and can
// be read back at any time (cron returns `ledgerTotal`; read the row directly
// for the full list).

export const ADVANCE_LEDGER_KEY = "pe_rejection_advance_ledger";
const LEDGER_CAP = 2000; // keep the most recent N entries; totalAdvanced is uncapped

export interface AdvanceLedgerEntry {
  dealId: string;
  dealName: string;
  changes: Record<string, string>;
  at: string;
}
export interface AdvanceLedger {
  totalAdvanced: number;
  lastRunAt: string;
  entries: AdvanceLedgerEntry[];
}

/**
 * Fold a run's advancements into the prior ledger (pure). `totalAdvanced` is the
 * lifetime count (never trimmed); `entries` keeps the most recent LEDGER_CAP.
 */
export function mergeAdvanceLedger(
  prev: AdvanceLedger | null,
  advanced: AdvanceResult["advanced"],
  atIso: string,
): AdvanceLedger {
  const base: AdvanceLedger = prev ?? { totalAdvanced: 0, lastRunAt: atIso, entries: [] };
  const fresh = advanced.map((a) => ({ ...a, at: atIso }));
  return {
    totalAdvanced: base.totalAdvanced + advanced.length,
    lastRunAt: atIso,
    entries: [...base.entries, ...fresh].slice(-LEDGER_CAP),
  };
}

/** Read + append + persist the ledger. Returns the updated ledger. */
export async function recordAdvanceLedger(
  advanced: AdvanceResult["advanced"],
  atIso: string,
): Promise<AdvanceLedger> {
  const { prisma } = await import("@/lib/db");
  const row = await prisma.systemConfig.findUnique({ where: { key: ADVANCE_LEDGER_KEY } });
  let prev: AdvanceLedger | null = null;
  if (row) {
    try {
      prev = JSON.parse(row.value) as AdvanceLedger;
    } catch {
      prev = null; // corrupt row → start fresh rather than throw
    }
  }
  const next = mergeAdvanceLedger(prev, advanced, atIso);
  await prisma.systemConfig.upsert({
    where: { key: ADVANCE_LEDGER_KEY },
    create: { key: ADVANCE_LEDGER_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

/**
 * Scan deals currently in pe_m1/m2_status = "Rejected" and advance any whose
 * rejection tasks are all completed. Returns the deals advanced.
 *
 * `dryRun` computes what WOULD advance without writing to HubSpot — used to
 * preview the first-run backlog before the cron goes live.
 */
export async function advancePeRejections(
  opts: { dryRun?: boolean } = {},
): Promise<AdvanceResult> {
  // 1) deals with a Rejected milestone (union of M1 + M2)
  const deals = new Map<string, { id: string; name: string; m1: string; m2: string }>();
  for (const field of ["pe_m1_status", "pe_m2_status"]) {
    let after: string | undefined;
    do {
      const res = await hubspotClient.crm.deals.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: field, operator: "EQ", value: REJECTED }] }],
        properties: ["dealname", "pe_m1_status", "pe_m2_status"],
        limit: 100,
        after,
      } as Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0]);
      for (const r of res.results) {
        deals.set(r.id, {
          id: r.id,
          name: r.properties.dealname || r.id,
          m1: r.properties.pe_m1_status || "",
          m2: r.properties.pe_m2_status || "",
        });
      }
      after = res.paging?.next?.after;
    } while (after);
  }

  const advanced: AdvanceResult["advanced"] = [];
  for (const d of deals.values()) {
    // 2) associated rejection tasks
    const assoc = await hubspotClient.crm.associations.v4.basicApi.getPage("deals", d.id, "tasks", undefined, 100);
    const tids = assoc.results.map((a) => a.toObjectId);
    const tasks: RejectionTask[] = [];
    for (let i = 0; i < tids.length; i += 100) {
      const tr = await hubspotClient.crm.objects.tasks.batchApi.read({
        inputs: tids.slice(i, i + 100).map((t) => ({ id: String(t) })),
        properties: ["hs_task_subject", "hs_task_status"],
      } as Parameters<typeof hubspotClient.crm.objects.tasks.batchApi.read>[0]);
      for (const t of tr.results) {
        const subject = t.properties.hs_task_subject || "";
        if (rejectionTaskMilestone(subject)) tasks.push({ subject, status: t.properties.hs_task_status || "" });
      }
    }

    // 3) decide + update
    const changes = advanceDecision({ m1Status: d.m1, m2Status: d.m2, tasks });
    if (Object.keys(changes).length > 0) {
      if (!opts.dryRun) {
        await hubspotClient.crm.deals.basicApi.update(d.id, { properties: changes });
      }
      advanced.push({ dealId: d.id, dealName: d.name, changes });
    }
  }

  return { scanned: deals.size, advanced };
}
