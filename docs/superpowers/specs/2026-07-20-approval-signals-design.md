# Approval Signals — Design Spec v2

**Date:** 2026-07-20
**Status:** Approved (Zach, in-session) — supersedes the 2026-07-17 draft on the
unmerged `docs/approval-signal-spec` branch.
**Goal:** Programmatically detect, from the shared inboxes, that a permit was
issued, an IC application approved, PTO granted, or an inspection passed — and
surface it as a one-click suggestion in the P&I Hub. Never write HubSpot
statuses automatically.

## What changed since the v1 draft (2026-07-17)

1. **The unified P&I Hub shipped** (`/dashboards/pi-hub`, three teams:
   permit / ic / pto). The v1 "no PTO coverage" non-goal is obsolete — PTO is
   a first-class team with its own statuses, and Zach explicitly asked for
   "PTOs granted" and "inspections passed".
2. **The dropdown is the only write path.** The `mark-permit-issued` /
   `mark-ic-approved` action routes v1 leaned on were removed (#1481 →
   status-only decision). The callout now routes into `setStatus` (same path
   as StatusDropdown) with a proposed value.
3. **The Xcel IA crosswalk landed** (all 2,274 applications; ~2,000 deals
   stamped with `xcel_ia_number`). Xcel chatter notifications — previously
   unmatchable — now bind to deals, and they are *templated*: "The
   Completeness Review for this interconnection application is approved",
   "has been granted Permission to Operate". A **rules-first pass** (regex on
   chatter templates) classifies these without an LLM call; Claude handles
   the long tail (AHJ mail, other utilities).
4. **In-app email viewer exists** (`/api/pi-hub/thread/[threadId]`): evidence
   links open in-app, not Gmail (delegated mailboxes can't be deep-linked).
5. **Gmail threads bundle multiple projects** (identical chatter subjects).
   Classification is per-MESSAGE, and a message only counts as evidence for a
   deal if it cites one of THAT deal's identifiers (IA #, case #, permit #)
   or cites no foreign identifier at all (see #1498's foreign-message test —
   reuse the same cited-identifier logic).

## Signal types and status mapping

| Signal | Candidate deals (status IN) | Proposed status (VALUE) | Evidence source |
|---|---|---|---|
| `permit_issued` | permit: Submitted to AHJ, Resubmitted to AHJ, Awaiting Utility Approval | `Complete` (label "Permit Issued") | AHJ mail in permit inboxes |
| `ic_approved` | ic: Submitted To Utility, Resubmitted To Utility, As-Built Resubmitted | the specific flavour detected: `Application Approved`, `Conditional Application Approval`, or `…Pending Signatures` variants | utility mail + Xcel chatter in IC inboxes |
| `pto_granted` | pto: Inspection Submitted to Utility, Resubmitted to Utility, Xcel Photos Submitted, Xcel Photos Resubmitted | `PTO` (label "PTO Granted") | utility mail + Xcel chatter |
| `xcel_photos_approved` | pto: Xcel Photos Submitted, Xcel Photos Resubmitted | `Xcel Photos Approved` | Xcel chatter |
| `inspection_passed` | permitting_status = `Complete` AND pto_status not yet at/past "Inspection Passed - Ready for Utility" (i.e. not in pto ready/waiting/resubmit/terminal groups) | pto: `Inspection Passed - Ready for Utility` | AHJ mail in permit inboxes |

The v1 open question (which IC flavour to propose) is resolved: **propose the
flavour the classifier detected** — it distinguishes "approved", "conditional",
and "pending signatures", and each is a real `interconnection_status` value.

## Retained from v1 (unchanged, see that draft for rationale)

- **Flag-only drift table + human triage**, mirroring `ZuperStatusDrift` /
  `DaStatusDrift`. Never write status automatically; false approvals corrupt
  PE milestone payments silently.
- **No claim of absence** — no flag ≠ not approved.
- **Conservative classifier**: verbatim quote required; bias to silence; only
  messages received AFTER `statusEnteredAt`; verdict cache by messageId;
  text-only (vision deferred).
- **Three-strikes dismissal**: dismissing suppresses that specific messageId;
  3 distinct dismissals → MUTED per deal+team; MUTED must be listable and
  un-mutable (admin escape hatch).
- **Shadow mode rollout**: `APPROVAL_SCAN_ENABLED` (cron) separate from
  `NEXT_PUBLIC_APPROVAL_SIGNALS_ENABLED` (UI). Scan and measure precision
  before anyone sees a badge.
- **Chunked cron** (~25 deals/run, rotating watermark, daily) — the
  zuper-status-reconcile 504 lesson. Cron path must be added to
  `PUBLIC_API_ROUTES` in middleware.
- **Deferred**: attachment/vision scanning (phase 2); Shovels permit records
  (blocked on address-hop + re-poll gaps).

## Data model (updated)

```prisma
model ApprovalSignal {
  id                  String    @id @default(cuid())
  hubspotDealId       String
  team                String    // "permit" | "ic" | "pto"
  signalType          String    // permit_issued | ic_approved | pto_granted | xcel_photos_approved | inspection_passed
  actualStatus        String    // HubSpot VALUE at detection time
  proposedStatus      String    // HubSpot VALUE the callout offers
  confidence          String    // "high" (rules-matched template) | "medium" (LLM)
  evidence            Json      // { messageId, threadId, mailbox, subject, quote, receivedAt, reasoning, citedIdentifiers }
  detectedAt          DateTime  @default(now())
  status              String    // OPEN | RESOLVED | DISMISSED | MUTED
  dismissedMessageIds String[]
  dismissCount        Int       @default(0)
  resolvedAt          DateTime?
  resolvedBy          String?

  @@unique([hubspotDealId, team, signalType])
  @@index([status])
}
```

`proposedStatus` is new (v1 hardcoded expectedStatus per team; flavours and the
two-status PTO path need it explicit). `signalType` is new. Verdict cache is a
separate small table:

```prisma
model ApprovalScanVerdict {
  messageId   String   @id
  verdict     String   // approved | pto_granted | photos_approved | inspection_passed | rejected | info_needed | other
  confidence  String
  classifiedAt DateTime @default(now())
}
```

## Classification pipeline

1. **Foreign-message guard** (pure, no LLM): extract cited identifiers
   (IA#/case#/permit#, leading-zero-insensitive — same logic as #1498). A
   message citing only OTHER projects' identifiers is skipped for this deal.
2. **Rules pass** (pure): Xcel chatter templates → verdict at `high`
   confidence with the template's matched sentence as the quote.
3. **Claude pass** (injected client, only for messages the rules don't
   decide): returns `{ verdict, confidence, quote, reasoning }`. Quote must
   be a verbatim substring of the message or the verdict is discarded
   (grounding check, enforced in code).
4. Only `high`/`medium` positive verdicts create/refresh a signal.

Module split mirrors pe-crossref: `src/lib/approval-scan/classify.ts` (pure,
all unit tests), `scan.ts` (orchestration), cron route (persistence +
watermark).

## UI surface (unified hub)

- Row badge — green "Looks approved" / "Looks issued" / "Looks granted" pill
  in the Stale-badge slot; header chip with count filters the list.
- Detail callout — quote, "view email" (opens the in-app thread viewer),
  `Dismiss`, and a one-click **Set status → <proposed label>** that calls the
  existing `setStatus` write path, then marks the signal RESOLVED.
- A status write to the proposed value from anywhere (dropdown included)
  auto-resolves the open signal for that deal+team.
- Labels via `getEnumLabelMap` — display labels, write values (#1481 class).

## Rollout

1. Merge dark (both flags absent/false in prod). Additive migration file
   ships in the PR; **Zach applies it** (`npm run db:migrate`) before enabling
   `APPROVAL_SCAN_ENABLED` — the new tables are not queried while flags are
   off, so merge order is safe.
2. Shadow-scan ≥1 week; measure precision from the drift table against
   reality (spot-check ~30 signals).
3. Enable UI for Zach/Peter; watch dismiss rates; consider auto-apply for
   `high`-confidence Xcel chatter only after measured precision supports it.
