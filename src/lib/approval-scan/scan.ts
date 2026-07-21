/**
 * Approval-signal scan orchestration — NO Prisma. Given a team + candidate
 * deals it routes each deal to its regional shared inbox, fetches messages
 * received after the deal entered its current status, runs the
 * guard → rules → cache → LLM pipeline, and returns proposed signal upserts
 * plus new verdict-cache entries. The cron route persists both.
 * Spec: docs/superpowers/specs/2026-07-20-approval-signals-design.md
 */

import {
  buildGmailThreadQuery,
  extractIdentifierTokens,
  fetchSharedInboxMessages,
  getSharedInboxAddress,
  type FetchMessagesResult,
  type InboxRegion,
} from "@/lib/gmail-shared-inbox";
import { locationInBucket } from "@/lib/idr-meeting";
import { fetchStatusEnteredAt } from "@/lib/status-entered";
import { TEAM_CONFIGS } from "@/lib/pi-hub/config";
import type { Team } from "@/lib/pi-hub/types";
import {
  classifyByRules,
  classifyWithClaude,
  extractCitedIdentifiers,
  isForeignEvidence,
  isPositiveVerdict,
  signalForVerdict,
  type ApprovalVerdict,
  type Classification,
  type SignalType,
  type VerdictConfidence,
} from "./classify";

// ---------------------------------------------------------------------------
// Candidate statuses
// ---------------------------------------------------------------------------

/**
 * Statuses that make a deal an approval-scan candidate — each team's
 * "waiting" group (submitted, awaiting a yes/no from the AHJ/utility).
 * The inspection_passed signal has its own candidate rule
 * (isInspectionCandidate in classify.ts): permitting_status = Complete AND
 * pto_status not yet at/past "Inspection Passed - Ready for Utility".
 */
export const CANDIDATE_STATUSES: Record<Team, readonly string[]> = {
  permit: TEAM_CONFIGS.permit.groups.waiting ?? [],
  ic: TEAM_CONFIGS.ic.groups.waiting ?? [],
  pto: TEAM_CONFIGS.pto.groups.waiting ?? [],
};

/**
 * Scan modes the cron rotates through. "inspection" scans permit inboxes
 * (AHJ mail) for inspection-passed evidence but raises team="pto" signals —
 * the proposed status lives on pto_status.
 */
export const SCAN_MODES = ["permit", "ic", "pto", "inspection"] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

/** Identifier deal properties per scan mode — mirrors pi-hub/detail.ts
 *  IDENTIFIER_PROPERTIES, with inspection using the permit set (the AHJ
 *  cites permit numbers, not IA/application numbers). */
export const SCAN_IDENTIFIER_PROPERTIES: Record<ScanMode, readonly string[]> = {
  permit: [
    "permit_number___pv",
    "permit_number___ess",
    "permit_number___elec",
    "permit_number___fire_protection",
    "permit_number___zoning___land_use",
  ],
  ic: ["utility_application__", "xcel_ia_number"],
  pto: ["utility_application__", "xcel_ia_number"],
  inspection: [
    "permit_number___pv",
    "permit_number___ess",
    "permit_number___elec",
    "permit_number___fire_protection",
    "permit_number___zoning___land_use",
  ],
};

export function signalTeamForMode(mode: ScanMode): Team {
  // Inspection evidence arrives in the PERMIT inboxes and the permit team
  // actions it (Zach 2026-07-20) — the proposed status is still a pto value.
  return mode === "inspection" ? "permit" : mode;
}

/** Inbox routing per mode: inspection evidence is AHJ mail → permit inboxes. */
function inboxTeamForMode(mode: ScanMode): "permit" | "ic" {
  return mode === "inspection" ? "permit" : TEAM_CONFIGS[mode].inboxTeam;
}

/** Status property whose entry time bounds the message window. Inspection
 *  candidates use permitting_status — inspections happen after the permit
 *  completed, so its "Complete" entry is the earliest relevant mail. */
function cutoffStatusPropertyForMode(mode: ScanMode): string {
  return mode === "inspection"
    ? TEAM_CONFIGS.permit.statusProperty
    : TEAM_CONFIGS[mode].statusProperty;
}

// ---------------------------------------------------------------------------
// Three-strikes state machine (pure — also used by the Cluster B dismiss API)
// ---------------------------------------------------------------------------

export type SignalStatus = "OPEN" | "RESOLVED" | "DISMISSED" | "MUTED";

export interface SignalDismissState {
  status: SignalStatus;
  dismissedMessageIds: readonly string[];
  dismissCount: number;
}

/**
 * Apply a user dismissal for the given evidence messageId. Dismissing
 * suppresses that specific messageId; the 3rd DISTINCT dismissed message
 * mutes the signal (MUTED is terminal for the scanner — only the admin
 * escape hatch un-mutes).
 */
export function applyDismiss(
  state: SignalDismissState,
  messageId: string,
): SignalDismissState {
  if (state.status === "MUTED") return { ...state };
  const ids = state.dismissedMessageIds.includes(messageId)
    ? [...state.dismissedMessageIds]
    : [...state.dismissedMessageIds, messageId];
  return {
    status: ids.length >= 3 ? "MUTED" : "DISMISSED",
    dismissedMessageIds: ids,
    dismissCount: ids.length,
  };
}

export type EvidenceAction = "create" | "refresh" | "reopen" | "skip";

export interface ExistingSignalState {
  status: SignalStatus;
  dismissedMessageIds: readonly string[];
  /** messageId of the evidence currently on the row. */
  evidenceMessageId?: string | null;
}

/**
 * What the scanner should do when it finds evidence `messageId` for a signal
 * whose current row is `state` (null = no row yet). New evidence reopens
 * RESOLVED/DISMISSED but never MUTED; the same messageId never re-flags.
 */
export function evidenceAction(
  state: ExistingSignalState | null,
  messageId: string,
): EvidenceAction {
  if (!state) return "create";
  if (state.status === "MUTED") return "skip";
  if (state.dismissedMessageIds.includes(messageId)) return "skip";
  if (state.status === "OPEN") return "refresh";
  // RESOLVED / DISMISSED — only genuinely new evidence reopens.
  if (state.evidenceMessageId === messageId) return "skip";
  return "reopen";
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface CandidateDeal {
  id: string;
  /** Must include the mode's status properties, identifier properties,
   *  address_line_1, project_number, pb_location. */
  properties: Record<string, string | null | undefined>;
}

export interface ExistingSignalRow extends ExistingSignalState {
  hubspotDealId: string;
  signalType: SignalType;
}

export interface SignalEvidence {
  messageId: string;
  threadId: string;
  mailbox: string;
  subject: string;
  quote: string;
  receivedAt: string;
  reasoning?: string;
  citedIdentifiers: string[];
}

export interface ProposedSignalUpsert {
  hubspotDealId: string;
  team: Team;
  signalType: SignalType;
  actualStatus: string;
  proposedStatus: string;
  confidence: "high" | "medium";
  evidence: SignalEvidence;
  action: Exclude<EvidenceAction, "skip">;
}

export interface VerdictCacheEntry {
  messageId: string;
  verdict: ApprovalVerdict;
  confidence: VerdictConfidence;
  /** Grounding quote — persisted so cache hits can still show evidence. */
  quote: string;
}

export interface CachedVerdict {
  verdict: ApprovalVerdict;
  confidence: VerdictConfidence;
  quote?: string | null;
}

export interface ScanDeps {
  fetchMessages: (opts: {
    mailbox: string;
    query: string;
    maxMessages?: number;
  }) => Promise<FetchMessagesResult>;
  fetchEnteredAt: (
    deals: Array<{ id: string; status: string }>,
    propertyName: string,
  ) => Promise<Map<string, number>>;
  /** Verdict cache lookup — a hit skips the LLM (rules still run; they are
   *  free and regenerate the quote). */
  getCachedVerdict: (messageId: string) => Promise<CachedVerdict | null>;
  /** LLM classification for messages the rules don't decide. */
  classifyLlm: (msg: { subject: string; body: string }) => Promise<Classification>;
}

/** Production deps — lazy Anthropic client so import stays side-effect free. */
export function liveScanDeps(
  getCachedVerdict: ScanDeps["getCachedVerdict"],
): ScanDeps {
  return {
    fetchMessages: fetchSharedInboxMessages,
    fetchEnteredAt: fetchStatusEnteredAt,
    getCachedVerdict,
    classifyLlm: async (msg) => {
      const { getAnthropicClient } = await import("@/lib/anthropic");
      return classifyWithClaude(getAnthropicClient(), msg);
    },
  };
}

export interface ScanResult {
  signals: ProposedSignalUpsert[];
  verdicts: VerdictCacheEntry[];
  stats: {
    deals: number;
    dealsSkippedMuted: number;
    dealsSkippedNoInbox: number;
    dealsSkippedNoCutoff: number;
    messages: number;
    messagesForeign: number;
    llmCalls: number;
  };
  errors: string[];
}

const MAX_MESSAGES_PER_DEAL = 20;

export async function scanApprovalSignals(input: {
  mode: ScanMode;
  deals: CandidateDeal[];
  existing: ExistingSignalRow[];
  deps: ScanDeps;
}): Promise<ScanResult> {
  const { mode, deals, existing, deps } = input;
  const team = signalTeamForMode(mode);
  const inboxTeam = inboxTeamForMode(mode);
  const cutoffProperty = cutoffStatusPropertyForMode(mode);
  const statusProperty = TEAM_CONFIGS[team].statusProperty;

  const result: ScanResult = {
    signals: [],
    verdicts: [],
    stats: {
      deals: deals.length,
      dealsSkippedMuted: 0,
      dealsSkippedNoInbox: 0,
      dealsSkippedNoCutoff: 0,
      messages: 0,
      messagesForeign: 0,
      llmCalls: 0,
    },
    errors: [],
  };

  // Existing rows keyed per deal: MUTED anywhere on (deal, team) skips the
  // deal (spec: MUTED is per deal+team); dismissed ids are unioned so a
  // message dismissed on one signalType can't resurface via another.
  const rowsByDeal = new Map<string, ExistingSignalRow[]>();
  for (const row of existing) {
    const list = rowsByDeal.get(row.hubspotDealId) ?? [];
    list.push(row);
    rowsByDeal.set(row.hubspotDealId, list);
  }

  // Cutoff timestamps for the whole batch in one pass (cached per status).
  const enteredAt = await deps.fetchEnteredAt(
    deals.map((d) => ({
      id: d.id,
      status: d.properties[cutoffProperty] ?? "",
    })),
    cutoffProperty,
  );

  // messageId → classification memo within this run — Gmail queries for
  // different deals can return the same bundled chatter message.
  const runVerdicts = new Map<string, Classification>();

  for (const deal of deals) {
    const props = deal.properties;
    const dealRows = rowsByDeal.get(deal.id) ?? [];

    if (dealRows.some((r) => r.status === "MUTED")) {
      result.stats.dealsSkippedMuted++;
      continue;
    }

    // Region → inbox routing (same CO/CA bucketing as pi-hub/detail.ts).
    let region: InboxRegion | null = null;
    if (locationInBucket(props.pb_location ?? null, "colorado")) region = "co";
    else if (locationInBucket(props.pb_location ?? null, "california")) region = "ca";
    const mailbox = region ? getSharedInboxAddress(inboxTeam, region) : null;
    if (!mailbox) {
      result.stats.dealsSkippedNoInbox++;
      continue;
    }

    // Conservative: without a resolvable status-entry time we cannot bound
    // the window, and pre-submission mail would flag stale approvals. Skip.
    const cutoffMs = enteredAt.get(deal.id);
    if (!cutoffMs) {
      result.stats.dealsSkippedNoCutoff++;
      continue;
    }

    const identifiers = SCAN_IDENTIFIER_PROPERTIES[mode].flatMap((p) =>
      extractIdentifierTokens(props[p]),
    );
    if (!props.address_line_1 && !props.project_number && identifiers.length === 0) {
      continue; // nothing project-unique to search on
    }

    // `after:` takes epoch seconds — precise, unlike day-granular dates.
    const query = `${buildGmailThreadQuery({
      address: props.address_line_1,
      projectNumber: props.project_number,
      identifiers,
    })} after:${Math.floor(cutoffMs / 1000)}`;

    const fetched = await deps.fetchMessages({
      mailbox,
      query,
      maxMessages: MAX_MESSAGES_PER_DEAL,
    });
    if (!fetched.ok) {
      result.errors.push(`deal ${deal.id}: ${fetched.error}`);
      continue;
    }

    const dismissedIds = new Set(
      dealRows.flatMap((r) => [...r.dismissedMessageIds]),
    );
    const actualStatus = props[statusProperty] ?? "";
    // Newest-first so the freshest evidence wins the per-signalType slot.
    const messages = [...fetched.messages].reverse();

    for (const message of messages) {
      if (new Date(message.date).getTime() < cutoffMs) continue;
      if (dismissedIds.has(message.id)) continue;
      result.stats.messages++;

      const text = `${message.subject}\n${message.plainTextBody}`;
      if (isForeignEvidence(text, identifiers)) {
        result.stats.messagesForeign++;
        continue;
      }

      // Rules → run memo → verdict cache → LLM. Rules run even on cache hits
      // (free, and they regenerate the verbatim quote from the live message).
      let classification = classifyByRules(message.subject, message.plainTextBody);
      const ruleMatched = classification !== null;
      if (!classification) {
        const memo = runVerdicts.get(message.id);
        if (memo) {
          classification = memo;
        } else {
          const cached = await deps.getCachedVerdict(message.id);
          if (cached) {
            classification = {
              verdict: cached.verdict,
              confidence: cached.confidence,
              quote: cached.quote ?? "",
            };
          } else {
            result.stats.llmCalls++;
            try {
              classification = await deps.classifyLlm({
                subject: message.subject,
                body: message.plainTextBody,
              });
            } catch (err) {
              result.errors.push(
                `classify failed for message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
              );
              continue;
            }
            result.verdicts.push({
              messageId: message.id,
              verdict: classification.verdict,
              confidence: classification.confidence,
              quote: classification.quote,
            });
          }
          runVerdicts.set(message.id, classification);
        }
      }

      if (!isPositiveVerdict(classification.verdict)) continue;
      if (classification.confidence === "low") continue;

      const proposal = signalForVerdict(team, actualStatus, classification.verdict);
      if (!proposal) continue;

      const rowState =
        dealRows.find((r) => r.signalType === proposal.signalType) ?? null;
      const action = evidenceAction(rowState, message.id);
      if (action === "skip") continue;

      const upsert: ProposedSignalUpsert = {
        hubspotDealId: deal.id,
        team,
        signalType: proposal.signalType,
        actualStatus,
        proposedStatus: proposal.proposedStatus,
        confidence: ruleMatched ? "high" : "medium",
        evidence: {
          messageId: message.id,
          threadId: message.threadId,
          mailbox,
          subject: message.subject,
          quote: classification.quote,
          receivedAt: message.date,
          reasoning: classification.reasoning,
          citedIdentifiers: extractCitedIdentifiers(text),
        },
        action,
      };

      // One proposal per (deal, signalType) per run — first (newest) wins.
      const already = result.signals.some(
        (s) =>
          s.hubspotDealId === deal.id && s.signalType === proposal.signalType,
      );
      if (!already) result.signals.push(upsert);
    }
  }

  return result;
}
