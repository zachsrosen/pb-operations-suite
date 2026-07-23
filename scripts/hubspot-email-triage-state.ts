#!/usr/bin/env npx tsx
/**
 * Read-only state fetch backing the `hubspot-email-triage` skill.
 * Given PROJ numbers parsed from HubSpot notification emails, returns each deal's
 * live state (plus one shared PE read) so the skill can decide whether the issue
 * each email describes is already resolved.
 *
 * Run: npx tsx scripts/hubspot-email-triage-state.ts PROJ-9584 PROJ-7353
 *      echo '["PROJ-9584"]' | npx tsx scripts/hubspot-email-triage-state.ts
 */
// MUST be the first import. `@/lib/hubspot` constructs its API client from
// process.env at import time, and TypeScript hoists all import declarations
// above ordinary statements — so a `dotenv.config()` call placed above the
// imports still runs too late and the client is built with no token (401).
// Side-effect imports keep their relative order, so this one wins.
// Requires running from the repo root, where .env lives.
import "dotenv/config";
import * as fs from "fs";

import {
  searchWithRetry,
  batchReadDealsWithRetry,
  hubspotClient,
  DEAL_STAGE_MAP,
} from "@/lib/hubspot";
import { listAllProjects, type PeProjectListItem } from "@/lib/pe-api";

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "21710069";

/** Properties the triage checks read. Names pinned in the implementation plan. */
const TRIAGE_PROPERTIES = [
  "dealname",
  "dealstage",
  "hubspot_owner_id",
  "permitting_status",
  "interconnection_status",
  "design_status",
  "layout_status",
  "pto_status",
  "da_revision_counter",
  "as_built_revision_counter",
  "permit_revision_counter",
  "interconnection_revision_counter",
  "total_revision_count",
  "rtb_blocked_reason",
  "on_hold_selection",
  "on_hold_reason",
  "sales_change_order_notes",
  "inspection_failure_reason",
  // Per-rejection-type causes — the verbatim "why" behind each blocker topic.
  "cause_of_permit_rejection_",
  "cause_of_interconnection_rejection_",
  "design_approval_rejection_reason",
  "pto_rejection_reason",
  "inspection_rejection_reason",
  // Close-out loose ends (trailing underscores are part of the real names).
  "loose_ends_remaining_",
  "loose_end_notes_",
  // Cancellation.
  "cancellation_reason",
  "cancellation_reason_category",
  "cancellation_date",
  "permit_completion_date",
  "pto_completion_date",
  "design_approval_sent_date",
  "layout_approval_date",
  "pe_m1_status",
  "pe_m1_submission_date",
  "pe_m1_approval_date",
  "pe_m1_rejection_date",
  "pe_m2_status",
  "pe_m2_approval_date",
  // Payment RECEIVED signals — PE financials only carry amounts owed.
  "pe_m1_paid_date",
  "pe_m2_paid_date",
  "pe_project_id",
];

export interface PeDocState {
  status: string | null;
  latestVersionDate: string | null;
}

export interface PeBlock {
  docs: Record<string, PeDocState>;
  /** Milestone status/dates come from the HubSpot deal, not the PE list payload. */
  milestones: {
    m1Status: string | null;
    m1ApprovalDate: string | null;
    m2Status: string | null;
    m2ApprovalDate: string | null;
  };
  payments: {
    /** Amounts OWED (from PE financials) — never a receipt signal. */
    amountAtIC: number | null;
    amountAtPC: number | null;
    /** Receipt signals (from the HubSpot deal). Non-null = paid. */
    m1PaidDate: string | null;
    m2PaidDate: string | null;
  };
  portalUrl: string | null;
}

export interface TriageRow {
  projNumber: string;
  dealId: string;
  dealName: string;
  dealStage: string | null;
  ownerId: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  designStatus: string | null;
  layoutStatus: string | null;
  ptoStatus: string | null;
  revisionCounters: Record<string, string | null>;
  reasons: Record<string, string | null>;
  /** `remaining` is a Yes/No enum — "Yes" means close-out work is still outstanding. */
  looseEnds: { remaining: string | null; notes: string | null };
  dates: Record<string, string | null>;
  milestoneStatus: { m1: string | null; m2: string | null };
  peProjectId: string | null;
  pe: PeBlock | null;
  hubspotUrl: string;
}

export interface TriageState {
  rows: Record<string, TriageRow>;
  notFound: string[];
  /** Run-wide: one failed listAllProjects() means no deal has PE data. */
  peUnavailable: boolean;
  peError?: string;
}

function prop(
  properties: Record<string, string | null | undefined>,
  key: string
): string | null {
  const v = properties[key];
  return v === undefined || v === "" ? null : (v as string | null);
}

/** PROJ-9584 must not match PROJ-95840. */
function dealNameMatches(dealName: string, proj: string): boolean {
  const digits = proj.replace(/^PROJ-/i, "");
  return new RegExp(`(^|[^0-9])PROJ-${digits}([^0-9]|$)`, "i").test(dealName);
}

async function resolveDeal(proj: string) {
  const res = await searchWithRetry({
    query: proj,
    limit: 20,
    properties: TRIAGE_PROPERTIES,
  } as Parameters<typeof searchWithRetry>[0]);
  const results = (res?.results ?? []) as Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  return results.find((r) => dealNameMatches(r.properties?.dealname ?? "", proj)) ?? null;
}

function toRow(
  proj: string,
  deal: { id: string; properties: Record<string, string | null> }
): TriageRow {
  const p = deal.properties ?? {};
  return {
    projNumber: proj,
    dealId: deal.id,
    dealName: prop(p, "dealname") ?? "",
    // Human-readable label; falls back to the raw stage ID if unmapped.
    dealStage: DEAL_STAGE_MAP[prop(p, "dealstage") ?? ""] ?? prop(p, "dealstage"),
    ownerId: prop(p, "hubspot_owner_id"),
    permittingStatus: prop(p, "permitting_status"),
    interconnectionStatus: prop(p, "interconnection_status"),
    designStatus: prop(p, "design_status"),
    layoutStatus: prop(p, "layout_status"),
    ptoStatus: prop(p, "pto_status"),
    revisionCounters: {
      da: prop(p, "da_revision_counter"),
      asBuilt: prop(p, "as_built_revision_counter"),
      permit: prop(p, "permit_revision_counter"),
      interconnection: prop(p, "interconnection_revision_counter"),
      total: prop(p, "total_revision_count"),
    },
    reasons: {
      rtbBlocked: prop(p, "rtb_blocked_reason"),
      onHoldSelection: prop(p, "on_hold_selection"),
      onHoldNotes: prop(p, "on_hold_reason"),
      salesChangeOrder: prop(p, "sales_change_order_notes"),
      inspectionFailure: prop(p, "inspection_failure_reason"),
      permitRejectionCause: prop(p, "cause_of_permit_rejection_"),
      interconnectionRejectionCause: prop(p, "cause_of_interconnection_rejection_"),
      daRejection: prop(p, "design_approval_rejection_reason"),
      ptoRejection: prop(p, "pto_rejection_reason"),
      asBuiltRevision: prop(p, "inspection_rejection_reason"),
      cancellation: prop(p, "cancellation_reason"),
      cancellationCategory: prop(p, "cancellation_reason_category"),
    },
    looseEnds: {
      remaining: prop(p, "loose_ends_remaining_"),
      notes: prop(p, "loose_end_notes_"),
    },
    dates: {
      permitIssued: prop(p, "permit_completion_date"),
      ptoGranted: prop(p, "pto_completion_date"),
      daSent: prop(p, "design_approval_sent_date"),
      daApproved: prop(p, "layout_approval_date"),
      m1Submission: prop(p, "pe_m1_submission_date"),
      m1Approval: prop(p, "pe_m1_approval_date"),
      m1Rejection: prop(p, "pe_m1_rejection_date"),
      m2Approval: prop(p, "pe_m2_approval_date"),
      m1Paid: prop(p, "pe_m1_paid_date"),
      m2Paid: prop(p, "pe_m2_paid_date"),
      cancelled: prop(p, "cancellation_date"),
    },
    milestoneStatus: {
      m1: prop(p, "pe_m1_status"),
      m2: prop(p, "pe_m2_status"),
    },
    peProjectId: prop(p, "pe_project_id"),
    pe: null,
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${deal.id}`,
  };
}

/**
 * Merges the PE-side project (docs, amounts) with the HubSpot-side row
 * (milestone status/dates, payment receipt dates). Both halves are required —
 * neither system alone answers "is this milestone paid/approved?".
 */
function buildPeBlock(project: PeProjectListItem, row: TriageRow): PeBlock {
  const docs: Record<string, PeDocState> = {};
  const documents = (project.documents ?? {}) as Record<
    string,
    { status?: string | null; versions?: Array<{ uploadedAt: string }> }
  >;
  for (const [key, info] of Object.entries(documents)) {
    const versions = info?.versions ?? [];
    const latest = versions.length
      ? versions
          .map((v) => v.uploadedAt)
          .filter(Boolean)
          .sort()
          .slice(-1)[0]
      : null;
    docs[key] = { status: info?.status ?? null, latestVersionDate: latest ?? null };
  }
  return {
    docs,
    milestones: {
      m1Status: row.milestoneStatus.m1,
      m1ApprovalDate: row.dates.m1Approval ?? null,
      m2Status: row.milestoneStatus.m2,
      m2ApprovalDate: row.dates.m2Approval ?? null,
    },
    payments: {
      amountAtIC: project.financials?.paymentAtIC ?? null,
      amountAtPC: project.financials?.paymentAtPC ?? null,
      m1PaidDate: row.dates.m1Paid ?? null,
      m2PaidDate: row.dates.m2Paid ?? null,
    },
    portalUrl: project.id
      ? `https://raceway.participate.energy/projects/${project.id}`
      : null,
  };
}

/**
 * Bulk mode — for backlog-scale runs (hundreds of deals).
 *
 * `fetchTriageState` does one search per PROJ number, which is fine for a
 * day's notifications and hopeless for a 1,800-email backlog. This fetches
 * every deal once (ids via search, then batch-read), builds a PROJ to row map
 * locally, and still makes exactly one PE call. Cost is flat in the number of
 * emails instead of linear in the number of deals.
 */
export async function fetchTriageStateBulk(): Promise<TriageState> {
  const ids: string[] = [];
  let after: string | undefined;
  let pages = 0;

  // Project pipeline only. An unfiltered search returns >10k deals, and
  // HubSpot's search API hard-caps at 10,000 — which silently hands back an
  // arbitrary truncated slice skewed to old records. PROJ-numbered deals all
  // live in this pipeline (~6.5k), which stays under the cap.
  const PROJECT_PIPELINE_ID = "6900017";

  do {
    const res = (await hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: "pipeline", operator: "EQ", value: PROJECT_PIPELINE_ID }] },
      ],
      properties: ["hs_object_id"],
      limit: 100,
      ...(after ? { after } : {}),
    } as Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0])) as {
      results?: Array<{ id: string }>;
      paging?: { next?: { after?: string } };
    };
    for (const r of res.results ?? []) ids.push(r.id);
    after = res.paging?.next?.after;
    pages++;
    if (pages % 20 === 0) console.error(`[bulk] ${ids.length} deal ids so far`);
  } while (after && pages < 100);

  if (pages >= 100) {
    // 100 pages x 100 = the 10,000 search ceiling. Past this the result set is
    // silently incomplete, so say so rather than reporting a confident count.
    console.error(
      `[bulk] WARNING: hit the 10,000-result search cap — deal set is INCOMPLETE. ` +
        `Narrow by pipeline or stage before trusting any "no rejection found" conclusion.`
    );
  }

  console.error(`[bulk] ${ids.length} deals; batch-reading properties`);

  const rows: Record<string, TriageRow> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await batchReadDealsWithRetry(ids.slice(i, i + 100), TRIAGE_PROPERTIES);
    for (const deal of (batch?.results ?? []) as Array<{
      id: string;
      properties: Record<string, string | null>;
    }>) {
      const name = deal.properties?.dealname ?? "";
      const m = /PROJ-(\d+)/i.exec(name);
      if (!m) continue;
      const proj = `PROJ-${m[1]}`;
      // Keep the first match; duplicate PROJ numbers are a data problem, not ours.
      if (!rows[proj]) rows[proj] = toRow(proj, deal);
    }
  }

  console.error(`[bulk] ${Object.keys(rows).length} deals keyed by PROJ; fetching PE`);

  let peProjects: PeProjectListItem[];
  try {
    peProjects = await listAllProjects();
  } catch (e) {
    return {
      rows,
      notFound: [],
      peUnavailable: true,
      peError: e instanceof Error ? e.message : String(e),
    };
  }

  const byProjectId = new Map(peProjects.map((p) => [p.projectId, p]));
  for (const row of Object.values(rows)) {
    if (!row.peProjectId) continue;
    const project = byProjectId.get(row.peProjectId);
    if (project) row.pe = buildPeBlock(project, row);
  }

  return { rows, notFound: [], peUnavailable: false };
}

export async function fetchTriageState(projNumbers: string[]): Promise<TriageState> {
  const unique = Array.from(new Set(projNumbers.map((p) => p.toUpperCase())));
  const rows: Record<string, TriageRow> = {};
  const notFound: string[] = [];

  for (const proj of unique) {
    const deal = await resolveDeal(proj);
    if (!deal) {
      notFound.push(proj);
      continue;
    }
    rows[proj] = toRow(proj, deal);
  }

  const needsPe = Object.values(rows).some((r) => r.peProjectId);
  if (!needsPe) return { rows, notFound, peUnavailable: false };

  // ONE PE read for the whole run — see spec "single PE read" rule.
  let peProjects: PeProjectListItem[];
  try {
    peProjects = await listAllProjects();
  } catch (e) {
    return {
      rows,
      notFound,
      peUnavailable: true,
      peError: e instanceof Error ? e.message : String(e),
    };
  }

  const byProjectId = new Map(peProjects.map((p) => [p.projectId, p]));
  for (const row of Object.values(rows)) {
    if (!row.peProjectId) continue;
    const project = byProjectId.get(row.peProjectId);
    if (!project) continue;
    row.pe = buildPeBlock(project, row);
  }

  return { rows, notFound, peUnavailable: false };
}

async function main() {
  if (process.argv.includes("--all")) {
    const state = await fetchTriageStateBulk();
    console.log(JSON.stringify(state));
    return;
  }

  const args = process.argv.slice(2).filter((a) => /^PROJ-\d+$/i.test(a));
  let projNumbers = args;

  if (!projNumbers.length && !process.stdin.isTTY) {
    const stdin = fs.readFileSync(0, "utf8").trim();
    if (stdin) {
      const parsed = JSON.parse(stdin);
      projNumbers = Array.isArray(parsed) ? parsed : [];
    }
  }

  if (!projNumbers.length) {
    console.error(
      "Usage: npx tsx scripts/hubspot-email-triage-state.ts PROJ-1234 [PROJ-5678 ...]\n" +
        '   or: echo \'["PROJ-1234"]\' | npx tsx scripts/hubspot-email-triage-state.ts'
    );
    process.exit(1);
  }

  const state = await fetchTriageState(projNumbers);
  console.log(JSON.stringify(state, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
