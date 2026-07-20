# Approval Signals — Implementation Plan

Spec: [2026-07-20-approval-signals-design.md](../specs/2026-07-20-approval-signals-design.md)
Branch: `feat/approval-signals` (dark launch — both flags off in prod).

## Cluster A — backend (schema, classifier, scan, cron)

1. `prisma/schema.prisma`: `ApprovalSignal` + `ApprovalScanVerdict` models per
   spec; additive migration SQL file under `prisma/migrations/` (NEVER applied
   in the build — Zach runs `npm run db:migrate`).
2. `src/lib/approval-scan/classify.ts` — pure module:
   - `extractCitedIdentifiers(text)` (IA#/case#/permit# regexes, zero-insensitive)
   - `isForeignEvidence(text, dealIdentifiers)` guard
   - `classifyByRules(subject, body)` — Xcel chatter templates → verdict+quote
   - `classifyWithClaude(client, msg)` — JSON verdict; verbatim-quote check
   - `signalForVerdict(team, currentStatus, verdict)` → {signalType, proposedStatus} | null
3. `src/lib/approval-scan/scan.ts` — candidate selection (HubSpot search per
   team's candidate statuses), region→inbox routing, identifier assembly,
   `statusEnteredAt` cutoff, `fetchSharedInboxMessages`, verdict cache check,
   three-strikes / muted skip logic. Returns proposed upserts (no Prisma writes
   here; caller persists).
4. `src/app/api/cron/approval-scan/route.ts` — flag check
   (`APPROVAL_SCAN_ENABLED`), CRON_SECRET auth like sibling crons, chunk ~25
   deals with rotating watermark (SystemConfig key), persist signals +
   verdicts.
5. `src/middleware.ts`: add cron path to `PUBLIC_API_ROUTES`. `vercel.json`:
   daily schedule + `maxDuration: 120` for the route.
6. `.env.example`: `APPROVAL_SCAN_ENABLED`, `NEXT_PUBLIC_APPROVAL_SIGNALS_ENABLED`.
7. Tests: `src/__tests__/approval-scan-classify.test.ts` (chatter fixtures:
   completeness-approved, PTO-granted, photos-approved, info-needed must NOT
   flag, rejection must NOT flag, foreign-identifier guard) +
   `approval-scan-state.test.ts` (three-strikes transitions, statusEnteredAt
   cutoff, signalForVerdict mapping incl. IC flavours).

## Cluster B — hub UI + signal APIs (after A)

1. Queue route: when UI flag on, join OPEN signals for the team and attach
   `{signalType, confidence}` to queue items; header count.
2. `Queue.tsx`: green pill in the Stale slot; header chip filter.
3. Detail: `SignalCallout` (quote, view-email → existing thread viewer,
   Dismiss, Set status → proposed label via existing setStatus flow).
4. `src/app/api/pi-hub/signals/route.ts`: POST dismiss (messageId strikes,
   MUTE at 3) / resolve; role-gated like sibling pi-hub routes.
5. `status.ts` hook: successful setStatus to proposedStatus auto-RESOLVEs.
6. Admin escape hatch: `/api/admin/approval-signals` GET muted + POST unmute.

## Gates

- Project-wide `tsc --noEmit` delta 0 vs 90-error baseline; pi-hub + new jest
  suites green; self-review diff; PR merged dark; migration note to Zach.
