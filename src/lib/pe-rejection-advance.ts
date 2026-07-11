/**
 * Auto-advance a deal's PE milestone status once its rejection tasks are all done.
 *
 * HubSpot workflows can't re-enroll on tasks or trigger on "all associated tasks
 * complete", so this runs as a poller (cron/pe-rejection-advance). When a deal's
 * M1 (or M2) rejection tasks are all completed — and at least one existed — the
 * milestone status advances. Three rejection flavors are handled (see TRANSITIONS):
 *   PE rejection:    "Rejected"            → "Ready to Resubmit"
 *   Onboarding (M1): "Onboarding Rejected" → "Onboarding Ready to Resubmit"
 *   Internal QC:     "Internally Rejected" → "Ready to Submit"
 * Each flavor gates only on its own tasks (classifyRejectionTask), so a stale PE
 * task can't block an onboarding advance, etc.
 *
 * Signal is TASK completion only (not doc status): docs stay action_required
 * until the actual resubmission, which happens AFTER this advance — so a
 * doc-status gate would never be satisfiable at this stage.
 */
import { hubspotClient } from "@/lib/hubspot";

// Rejection statuses we advance FROM, and what each advances TO once its tasks
// are done. Three flavors share one poller:
//   PE rejection:       "Rejected"            → "Ready to Resubmit"
//   Onboarding (M1):    "Onboarding Rejected" → "Onboarding Ready to Resubmit"
//   Internal QC:        "Internally Rejected" → "Ready to Submit"  (pre-PE state)
const REJECTED = "Rejected";
export const READY = "Ready to Resubmit";
const ONBOARDING_REJECTED = "Onboarding Rejected";
export const ONBOARDING_READY = "Onboarding Ready to Resubmit";
const INTERNALLY_REJECTED = "Internally Rejected";
const READY_TO_SUBMIT = "Ready to Submit";
const OPEN_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "WAITING"]);

export interface RejectionTask {
  subject: string;
  status: string;
}

export type RejectionFlavor = "pe" | "onboarding" | "internal";

/**
 * Classify a task as a rejection task — its milestone + flavor — or null.
 *
 * Matches on the signal words a rejection task carries, so subjects stay freely
 * renameable (e.g. "Sales M1 Rejection", "M1 Rejected by Participate Energy #1 -
 * ZRS") as long as they keep those signals:
 *   - a rejection word — reject / rejected / rejection (required for all)
 *   - onboarding: also contains "onboarding" → flavor onboarding, milestone M1
 *     (onboarding is the M1 pre-submission sub-lifecycle; there is no M2 onboarding)
 *   - internal:   also contains "internal" + a standalone M1/M2 token
 *   - pe:         a standalone M1/M2 token, and neither "onboarding" nor "internal"
 * Order matters: onboarding/internal are checked before plain PE so a keyworded
 * task isn't misread as a PE rejection.
 */
export function classifyRejectionTask(
  subject: string,
): { milestone: "m1" | "m2"; flavor: RejectionFlavor } | null {
  if (!/reject(ed|ion)?/i.test(subject)) return null;
  if (/onboarding/i.test(subject)) return { milestone: "m1", flavor: "onboarding" };
  const m1 = /\bM1\b/i.test(subject);
  const m2 = /\bM2\b/i.test(subject);
  if (/internal/i.test(subject)) {
    if (m1) return { milestone: "m1", flavor: "internal" };
    if (m2) return { milestone: "m2", flavor: "internal" };
    return null; // internal needs a milestone token to know which one
  }
  if (m1) return { milestone: "m1", flavor: "pe" };
  if (m2) return { milestone: "m2", flavor: "pe" };
  return null;
}

/** PE-rejection milestone (back-compat wrapper). Onboarding/internal → null. */
export function rejectionTaskMilestone(subject: string): "m1" | "m2" | null {
  const c = classifyRejectionTask(subject);
  return c && c.flavor === "pe" ? c.milestone : null;
}

export function isOpenTask(status: string): boolean {
  return OPEN_STATUSES.has(status);
}
export function isCompletedTask(status: string): boolean {
  return status === "COMPLETED";
}

/** One auto-advance rule: a milestone in `from` whose `flavor` tasks are all done → `to`. */
interface Transition {
  milestone: "m1" | "m2";
  from: string;
  flavor: RejectionFlavor;
  to: string;
}
const TRANSITIONS: Transition[] = [
  { milestone: "m1", from: REJECTED, flavor: "pe", to: READY },
  { milestone: "m2", from: REJECTED, flavor: "pe", to: READY },
  { milestone: "m1", from: ONBOARDING_REJECTED, flavor: "onboarding", to: ONBOARDING_READY },
  { milestone: "m1", from: INTERNALLY_REJECTED, flavor: "internal", to: READY_TO_SUBMIT },
  { milestone: "m2", from: INTERNALLY_REJECTED, flavor: "internal", to: READY_TO_SUBMIT },
];

/** The distinct "from" statuses to scan for, per status field (drives the deal search). */
export const ADVANCE_FROM_STATUSES: Record<"pe_m1_status" | "pe_m2_status", string[]> = {
  pe_m1_status: [...new Set(TRANSITIONS.filter((t) => t.milestone === "m1").map((t) => t.from))],
  pe_m2_status: [...new Set(TRANSITIONS.filter((t) => t.milestone === "m2").map((t) => t.from))],
};

/**
 * Decide which milestone statuses to advance. For each transition rule, if the
 * milestone is currently in the rule's `from` status, it advances to `to` only
 * when that flavor's tasks for that milestone all exist (≥1) and none are open.
 * A milestone holds one status at a time, so at most one rule fires per milestone.
 */
export function advanceDecision(input: {
  m1Status: string;
  m2Status: string;
  tasks: RejectionTask[];
}): { pe_m1_status?: string; pe_m2_status?: string } {
  const out: { pe_m1_status?: string; pe_m2_status?: string } = {};
  for (const rule of TRANSITIONS) {
    const status = rule.milestone === "m1" ? input.m1Status : input.m2Status;
    if (status !== rule.from) continue;
    const relevant = input.tasks.filter((t) => {
      const c = classifyRejectionTask(t.subject);
      return c?.milestone === rule.milestone && c?.flavor === rule.flavor;
    });
    if (relevant.length === 0) continue; // guard: never had matching tasks → don't flip
    const anyOpen = relevant.some((t) => isOpenTask(t.status));
    const anyCompleted = relevant.some((t) => isCompletedTask(t.status));
    if (!anyOpen && anyCompleted) {
      out[rule.milestone === "m1" ? "pe_m1_status" : "pe_m2_status"] = rule.to;
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
 * Scan deals sitting in any advanceable rejection status (Rejected / Onboarding
 * Rejected / Internally Rejected, across M1 + M2) and advance any whose matching
 * rejection tasks are all completed. Returns the deals advanced.
 *
 * `dryRun` computes what WOULD advance without writing to HubSpot — used to
 * preview the first-run backlog before the cron goes live.
 */
export async function advancePeRejections(
  opts: { dryRun?: boolean } = {},
): Promise<AdvanceResult> {
  // 1) deals sitting in any advanceable rejection status (union across M1 + M2)
  const deals = new Map<string, { id: string; name: string; m1: string; m2: string }>();
  for (const [field, values] of Object.entries(ADVANCE_FROM_STATUSES)) {
    let after: string | undefined;
    do {
      const res = await hubspotClient.crm.deals.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: field, operator: "IN", values }] }],
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
        if (classifyRejectionTask(subject)) tasks.push({ subject, status: t.properties.hs_task_status || "" });
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
