/**
 * Approval-signal classification — PURE module (no Prisma, no network; the
 * Anthropic client is injected). All unit-testable logic for the inbox
 * approval scanner lives here; scan.ts orchestrates, the cron persists.
 * Spec: docs/superpowers/specs/2026-07-20-approval-signals-design.md
 */

import { TEAM_CONFIGS } from "@/lib/pi-hub/config";
import type { Team } from "@/lib/pi-hub/types";

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const APPROVAL_VERDICTS = [
  "approved",
  "conditional_approved",
  "approved_pending_signatures",
  "pto_granted",
  "photos_approved",
  "inspection_passed",
  "rejected",
  "info_needed",
  "other",
] as const;

export type ApprovalVerdict = (typeof APPROVAL_VERDICTS)[number];

export type VerdictConfidence = "high" | "medium" | "low";

export interface Classification {
  verdict: ApprovalVerdict;
  confidence: VerdictConfidence;
  /** Verbatim substring of the message (grounding is enforced in code). */
  quote: string;
  reasoning?: string;
}

/** Verdicts that can ever produce a signal. rejected/info_needed/other are
 *  cached to suppress re-classification but never flag. */
const POSITIVE_VERDICTS: readonly ApprovalVerdict[] = [
  "approved",
  "conditional_approved",
  "approved_pending_signatures",
  "pto_granted",
  "photos_approved",
  "inspection_passed",
];

export function isPositiveVerdict(verdict: ApprovalVerdict): boolean {
  return POSITIVE_VERDICTS.includes(verdict);
}

// ---------------------------------------------------------------------------
// Cited-identifier extraction + foreign-message guard
// ---------------------------------------------------------------------------

/**
 * Application-identifier shapes a message can cite: Xcel IA numbers, 8-digit
 * case numbers, and alphanumeric permit/application tokens ("B2404681",
 * "SBP-179859", "OID4677235"). Canonical version of the logic in
 * CorrespondencePanel.tsx (#1498) — leading zeros are stripped for comparison
 * because legacy deals store case numbers un-padded.
 */
const CITED_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\bIA\d{5,}\b/gi,
  /\b0\d{7}\b/g,
  // Letter-prefixed tokens need 5+ digits so PROJ-1234 / date fragments and
  // other short codes don't register as application identifiers.
  /\b[A-Z]{1,4}-?\d{5,}\b/gi,
];

export function normalizeIdentifier(raw: string): string {
  return raw.toUpperCase().replace(/^0+(?=\d)/, "");
}

export function extractCitedIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of CITED_IDENTIFIER_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      found.add(normalizeIdentifier(m[0]));
    }
  }
  return [...found];
}

/**
 * True when the message cites application identifiers and NONE of them belong
 * to this deal — i.e. Gmail bundled another project's notification into a
 * matched thread (Xcel chatter emails all share one subject line). A message
 * citing no identifiers at all is NOT foreign (it matched the deal's address
 * or PROJ number in the Gmail query).
 */
export function isForeignEvidence(
  text: string,
  dealIdentifiers: readonly string[],
): boolean {
  const own = new Set(
    dealIdentifiers.filter(Boolean).map((t) => normalizeIdentifier(t)),
  );
  if (own.size === 0) return false;
  const cited = extractCitedIdentifiers(text);
  return cited.length > 0 && !cited.some((c) => own.has(c));
}

// ---------------------------------------------------------------------------
// Rules pass — templated Xcel chatter sentences (no LLM call needed)
// ---------------------------------------------------------------------------

interface ChatterRule {
  verdict: ApprovalVerdict;
  pattern: RegExp;
}

// Negative rules run FIRST — an "Additional Information Needed" or rejection
// notice must suppress classification even if approval-ish words appear
// elsewhere in the body (quoted history, boilerplate).
const NEGATIVE_RULES: readonly ChatterRule[] = [
  { verdict: "info_needed", pattern: /additional\s+information\s+(?:is\s+)?needed/i },
  { verdict: "info_needed", pattern: /action\s+required/i },
  { verdict: "rejected", pattern: /\b(?:rejected|rejection|denied|has\s+been\s+cancell?ed|cannot\s+be\s+approved|does\s+not\s+meet)\b/i },
];

// Positive rules match the utility's templated chatter sentences. Patterns
// tolerate arbitrary wrapping whitespace (chatter bodies hard-wrap). They are
// anchored to perfect/present forms — negated or future-conditional phrasings
// ("has not been granted…", "will be granted… once…") must NOT rule-match;
// they fall through to the LLM. There is deliberately NO photos_approved
// positive rule: photo-approval language is too varied to template safely,
// so photos approvals always go to the LLM (medium confidence).
const POSITIVE_RULES: readonly ChatterRule[] = [
  {
    verdict: "approved",
    pattern: /The\s+Completeness\s+Review\s+for\s+this\s+interconnection\s+application\s+is\s+approved/i,
  },
  {
    verdict: "pto_granted",
    pattern: /(?:(?:has\s+been|have\s+been|is|was)\s+granted\s+Permission\s+to\s+Operate|Permission\s+to\s+Operate\s+(?:has\s+been|was|is)\s+granted)/i,
  },
];

/** Negation/futurity cues that disqualify a positive template match when they
 *  appear in the text immediately preceding it ("has not been granted…",
 *  "Once your photos are reviewed and approved, …"). */
const PRE_MATCH_GUARD =
  /\b(?:not|never|cannot|can't|won't|will\s+not|unless|until|once|after|upon|pending|before|if)\b/i;
const PRE_MATCH_WINDOW = 60;

/**
 * Rules-first classification of the templated Xcel chatter notifications.
 * Returns null when no rule fires (the long tail goes to Claude). The quote
 * is the matched text verbatim from the message so grounding holds by
 * construction.
 */
export function classifyByRules(
  subject: string,
  body: string,
): Classification | null {
  const combined = `${subject}\n${body}`;
  for (const rule of NEGATIVE_RULES) {
    const m = combined.match(rule.pattern);
    if (m) return { verdict: rule.verdict, confidence: "high", quote: m[0] };
  }
  for (const rule of POSITIVE_RULES) {
    // Positive quotes must come from the body — a subject-only match ("Xcel
    // photos approved?" style) is not template evidence.
    const m = body.match(rule.pattern);
    if (!m || m.index === undefined) continue;
    // A negation inside the matched span, or a negation/futurity cue in the
    // window just before it, is not an approval — leave those for the LLM
    // rather than mis-rule them.
    if (/\b(?:not|never|un)\b/i.test(m[0])) continue;
    const preceding = body.slice(
      Math.max(0, m.index - PRE_MATCH_WINDOW),
      m.index,
    );
    if (PRE_MATCH_GUARD.test(preceding)) continue;
    return { verdict: rule.verdict, confidence: "high", quote: m[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claude pass — long tail (AHJ mail, non-Xcel utilities)
// ---------------------------------------------------------------------------

export const APPROVAL_SCAN_MODEL = "claude-haiku-4-5-20251001";

/** Structural subset of the Anthropic SDK client — injected so this module
 *  stays pure and tests can pass a stub. */
export interface ClaudeMessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

// Bound the body so a long quoted-history chain can't blow up the prompt.
const MAX_BODY_CHARS = 8000;

const CLASSIFY_PROMPT = `You are classifying an email received in a solar company's permitting/interconnection inbox. Decide whether it announces a POSITIVE milestone for the project it concerns.

Respond with STRICT JSON only (no markdown, no prose):
{"verdict": "...", "confidence": "high|medium|low", "quote": "...", "reasoning": "..."}

verdict must be exactly one of:
- "approved" — interconnection application / permit approved or issued
- "conditional_approved" — application approved with conditions
- "approved_pending_signatures" — approved but awaiting signatures
- "pto_granted" — Permission to Operate granted
- "photos_approved" — utility photo submission approved
- "inspection_passed" — AHJ/final inspection passed
- "rejected" — application/inspection rejected or denied
- "info_needed" — sender is requesting more information or action
- "other" — anything else, including status updates, receipts, and anything ambiguous

quote must be an EXACT verbatim sentence copied from the email that proves the verdict. Do not paraphrase.

Be conservative: if you are not certain the email announces the milestone for THIS project, answer "other". A forwarded or quoted approval inside a newer message asking for changes is NOT an approval.`;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Verbatim-substring grounding check (whitespace-insensitive). */
export function quoteIsGrounded(
  quote: string,
  subject: string,
  body: string,
): boolean {
  const needle = normalizeWhitespace(quote);
  if (!needle) return false;
  return normalizeWhitespace(`${subject}\n${body}`).includes(needle);
}

/**
 * Single-message Claude classification. Enforces in code that the returned
 * quote is a verbatim substring of subject+body — a hallucinated quote
 * degrades the verdict to "other" (bias to silence).
 */
export async function classifyWithClaude(
  client: ClaudeMessagesClient,
  msg: { subject: string; body: string },
): Promise<Classification> {
  const body = msg.body.slice(0, MAX_BODY_CHARS);
  const response = await client.messages.create({
    model: APPROVAL_SCAN_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `${CLASSIFY_PROMPT}\n\nSubject: ${msg.subject}\n\nBody:\n${body}`,
      },
    ],
  });

  const text = response.content.find((c) => c.type === "text")?.text ?? "";
  const parsed = parseVerdictJson(text);
  if (!parsed) return { verdict: "other", confidence: "low", quote: "" };

  if (
    isPositiveVerdict(parsed.verdict) &&
    !quoteIsGrounded(parsed.quote, msg.subject, body)
  ) {
    return {
      verdict: "other",
      confidence: "low",
      quote: "",
      reasoning: `quote not grounded: ${parsed.quote.slice(0, 120)}`,
    };
  }
  return parsed;
}

function parseVerdictJson(text: string): Classification | null {
  // Tolerate a fenced or prefixed response — extract the first JSON object.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const verdict = raw.verdict;
    const confidence = raw.confidence;
    if (
      typeof verdict !== "string" ||
      !(APPROVAL_VERDICTS as readonly string[]).includes(verdict)
    ) {
      return null;
    }
    return {
      verdict: verdict as ApprovalVerdict,
      confidence:
        confidence === "high" || confidence === "medium" ? confidence : "low",
      quote: typeof raw.quote === "string" ? raw.quote : "",
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verdict → signal mapping (the spec's candidate table)
// ---------------------------------------------------------------------------

export type SignalType =
  | "permit_issued"
  | "ic_approved"
  | "pto_granted"
  | "xcel_photos_approved"
  | "inspection_passed";

export interface SignalProposal {
  signalType: SignalType;
  /** HubSpot VALUE the callout offers (labels resolved at display time). */
  proposedStatus: string;
}

const PERMIT_WAITING = TEAM_CONFIGS.permit.groups.waiting ?? [];
const IC_WAITING = TEAM_CONFIGS.ic.groups.waiting ?? [];
const PTO_WAITING = TEAM_CONFIGS.pto.groups.waiting ?? [];
const XCEL_PHOTO_STATUSES = ["Xcel Photos Submitted", "Xcel Photos Resubmitted"];

// The IC flavour the classifier detected maps to that exact status VALUE.
const IC_FLAVOURS: Partial<Record<ApprovalVerdict, string>> = {
  approved: "Application Approved",
  conditional_approved: "Conditional Application Approval",
  approved_pending_signatures: "Application Approved - Pending Signatures",
};

/** pto statuses at/past "Inspection Passed - Ready for Utility" — a deal in
 *  any of these is NOT an inspection-passed candidate (spec: ready/waiting/
 *  resubmit/rejection/terminal groups plus the post-inspection "other"
 *  statuses), so inspection_passed can never propose a regression. Exported
 *  for the cron's HubSpot NOT_IN filter. */
export const PTO_AT_OR_PAST_INSPECTION: readonly string[] = [
  ...(TEAM_CONFIGS.pto.groups.ready ?? []),
  ...PTO_WAITING,
  ...(TEAM_CONFIGS.pto.groups.resubmit ?? []),
  ...(TEAM_CONFIGS.pto.groups.rejections ?? []),
  ...TEAM_CONFIGS.pto.terminalStatuses,
  // Post-inspection "other"-group statuses (Zach 2026-07-17 grouping
  // decision) — a deal here already passed inspection.
  "Xcel Photos Approved",
  "Conditional PTO - Pending Transformer Upgrade",
];

export function isInspectionCandidate(
  permittingStatus: string | null | undefined,
  ptoStatus: string | null | undefined,
): boolean {
  if (permittingStatus !== "Complete") return false;
  return !PTO_AT_OR_PAST_INSPECTION.includes(ptoStatus ?? "");
}

/**
 * Map a (team, current status, verdict) to the signal it should raise, or
 * null for every combination outside the spec's candidate table. For
 * `inspection_passed` the team is "pto" and `currentStatus` is the deal's
 * pto_status (the permitting_status = Complete precondition is checked by
 * the caller via isInspectionCandidate).
 */
export function signalForVerdict(
  team: Team,
  currentStatus: string,
  verdict: ApprovalVerdict,
): SignalProposal | null {
  if (!isPositiveVerdict(verdict)) return null;

  switch (team) {
    case "permit":
      if (verdict === "approved" && PERMIT_WAITING.includes(currentStatus)) {
        return { signalType: "permit_issued", proposedStatus: "Complete" };
      }
      return null;

    case "ic": {
      const flavour = IC_FLAVOURS[verdict];
      if (flavour && IC_WAITING.includes(currentStatus)) {
        return { signalType: "ic_approved", proposedStatus: flavour };
      }
      return null;
    }

    case "pto":
      if (verdict === "pto_granted" && PTO_WAITING.includes(currentStatus)) {
        return { signalType: "pto_granted", proposedStatus: "PTO" };
      }
      if (
        verdict === "photos_approved" &&
        XCEL_PHOTO_STATUSES.includes(currentStatus)
      ) {
        return {
          signalType: "xcel_photos_approved",
          proposedStatus: "Xcel Photos Approved",
        };
      }
      if (
        verdict === "inspection_passed" &&
        !PTO_AT_OR_PAST_INSPECTION.includes(currentStatus)
      ) {
        return {
          signalType: "inspection_passed",
          proposedStatus: "Inspection Passed - Ready for Utility",
        };
      }
      return null;
  }
}
