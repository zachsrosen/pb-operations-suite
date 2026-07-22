# HubSpot Email Triage — Design Spec

**Date:** 2026-07-21
**Status:** Approved design, pending spec review
**Deliverables:** a new personal skill `hubspot-email-triage` (in `~/.claude/skills/`) + one read-only repo script `scripts/hubspot-email-triage-state.ts`

## Problem

Zach receives ~200 HubSpot notification emails per week from `noreply@notifications.hubspot.com`,
filtered into `HubSpot/*` Gmail labels (most skip the inbox). They go stale fast: a mention about a
permit rejection sits unread after the permit is issued; a "PE Has Not Paid" nudge lingers after the
payment lands. There is no repeatable way to answer, per email: **is the underlying issue already
resolved, or does it still need action?**

The `pe-rejection-audit` skill solves this deeply for exactly one stream (PE rejection emails). This
design generalizes its architecture — *never trust the email; check the live source of truth* — to
the whole notification firehose.

## Definition of "actioned"

**The underlying blocker is resolved, regardless of who resolved it.** A mention about a permit
rejection is actioned when the permit is issued. A "DA held up" comment is actioned when the DA is
approved. Zach replying is only one of several resolution signals, and only the deciding one when
the mention is a direct question to him with no associated deal-state blocker.

## Architecture

Two units:

1. **The skill** (`~/.claude/skills/hubspot-email-triage/SKILL.md`) — orchestration + judgment.
   Fetches emails via the Gmail MCP, classifies each by subject pattern, extracts blocker topics
   from bodies where needed, calls the state script, compares email complaint vs live state,
   reports, and (on explicit approval) trashes the actioned set.
2. **The state script** (`scripts/hubspot-email-triage-state.ts`) — deterministic bulk reads.
   Input: PROJ numbers (args or stdin JSON). Output: JSON array, one row per deal, with the live
   state fields listed below. No writes. Uses the repo's rate-limit-wrapped HubSpot client
   (`searchWithRetry()` convention) and, for PE fields, joins via the `pe_project_id` deal property
   (never PE `_hubspot.recordId`, which is stale — same rule as `pe-rejection-audit`).

The skill can run without the script (ad-hoc MCP lookups) for small batches, but the script is the
default path — one batched read for a 200-email run.

### Script output row (contract)

Per deal: `projNumber`, `dealId`, `dealname`, `dealstage` (labeled), `hubspot_owner` (name),
`permitting_status`, `interconnection_status`, `design_status`, DA status/rejection props,
revision counters, the deal-state reason fields (RTB / on-hold / cancellation reason + category /
per-rejection-type causes for permit, interconnection, DA, PTO, as-built / inspection failure /
loose-ends flag + notes / PE — the `stateContext` set from #1410), `pe_project_id`,
utility photo / PTO submission status (the property behind the `Xcel Photos Approved` and
`PTO Rejected or Pending` notification states), key dates (permit issued, PTO granted,
DA sent/signed, M1/M2 submission+approval), a HubSpot deal URL, and — for deals with a
`pe_project_id` — the PE portal URL (`https://raceway.participate.energy/projects/<pe_project_id>`).

**PE block (script-side; the skill never calls the PE API itself).** For deals with a
`pe_project_id`, the script also reads the live PE project via `src/lib/pe-api.ts`
(`listAllProjects()`, joined by `pe_project_id`) and returns per deal:

- `peDocs`: map of document key → `{ status, latestVersionDate }` (status may be `null` =
  not uploaded; `latestVersionDate` supports the versions-after-rejection check)
- `peMilestones`: M1/M2 status (submitted / under review / approved) + approval dates
- `pePayments`: payment-received signals (`financials.paymentAtIC` / `paymentAtPC` and the
  date-gated received logic used by the PE Received Total work)

**This block is the single PE read for the entire triage run** — it serves the PE-rejection stream
as well as PE nudges, PE doc requests, and the PE blocker-mapping rows. `listAllProjects()` returns
every project in one call, so one read covers all of them. The triage skill therefore does NOT
invoke `scripts/pe-rejection-status-check.ts` (which would make a second independent
`listAllProjects()` call and burn a second share of the 5000/day quota); it applies
`pe-rejection-audit`'s *rules* to this block's data. That standalone script remains the right tool
when running the PE rejection audit on its own, outside triage.

If the PE read fails or quota is exhausted, `peUnavailable: true` is set **run-wide** (one failed
`listAllProjects()` means no deal has PE data — the flag is not evaluated per-deal), and every
PE-dependent email is kept (see Error handling).

Exact HubSpot property names are resolved at build time from `src/lib/` (the `get_deal`
stateContext implementation is the reference); the contract is the *semantic* list above, and
the build plan must enumerate and pin the real property names so the contract test asserts
actual fields.

Deals not found (bad PROJ parse, deleted deal) are returned in a `notFound` list — the skill treats
their emails as **open/unknown**, never actioned.

## Classification table

Every email from `noreply@notifications.hubspot.com` is classified by subject pattern. First match
wins; patterns are case-insensitive.

| Stream | Subject patterns | Resolution check |
|---|---|---|
| PE rejections | `* Rejected by PE -`, and the PE-doc variants without "by PE" (`Conditional Progress Lien Waiver Rejected`, `Signed Final Permit Rejected`, `Conditional Waiver - Final Payment Rejected`) | **`pe-rejection-audit`'s rules, applied to the script's PE block** (`RESPONSE_NEEDED` = open; `versions[]`/`latestVersionDate` check for admin-clears). This skill never re-implements or re-derives those rules — it cites them. |
| PE nudges | `PE Has Not Reviewed M1 in 5 Days`, `PE Has Not Reviewed M2 in 5 Days`, `PE Has Not Paid in 14 Days` | PE API: milestone status now reviewed/approved → actioned. Not-paid: payment now received (`financials` / PE Received Total logic) → actioned. |
| PE doc requests | `Load Justification Form Needed by PE` | PE API: the named doc now uploaded (status non-null) → actioned. `null` = open (doc was specifically requested — same rule as pe-rejection-audit's named-null gotcha). |
| Utility rejections | `Interconnection Rejected - PROJ-` (SCE/PG&E/Xcel/Black Hills; label `HubSpot/Interconnection Rejected`) | `interconnection_status` — resubmitted/approved or no longer rejected → actioned. |
| Utility photo rejections | `Xcel Photos Rejected - PROJ-` (label `HubSpot/PTO Rejected or Pending`) | The contract's utility photo / PTO submission status is no longer in a rejected/pending-fix state, **or** a PTO-granted date exists → actioned. |
| Mentions / comments | `You were mentioned on`, `New comments on the deal` | **Content-based** (see blocker mapping below). |
| Task assignments | `* assigned you the task`, `* mentioned you the task` | The named task's `hs_task_status` is no longer `NOT_STARTED` → actioned; else content-based like mentions. The task is identified by the task ID in the notification's HubSpot link, falling back to subject-name match against the deal's open tasks; if neither resolves a single task, the email is **open/unknown**. This is an ad-hoc skill-side HubSpot task lookup, not part of the script contract. |
| Assignments | `You have been made the * of the deal` | FYI — always actioned. |
| Design flow | `Design Uploaded by Vishtik` | Actioned when the design review moved on: the deal's design closeout/review task is completed (ad-hoc skill-side HubSpot task lookup, not part of the script contract) or `design_status` has advanced past review. |
| Design flow | `DA Sent` | FYI — always actioned. |
| Status FYIs | `PTO Granted`, `M1 Approved`, `M2 Approved`, `Permit Issued`, `Design Approved`, `Xcel Photos Approved` | FYI — always actioned. |
| Reports | `Site Survey \|`, `Weekly data quality` — plus sentiment digests and HubSpot product/permission notices, whose exact subject patterns are concretized during the 30-day subject validation in the build (until then they fall to Unknown, which is safe) | FYI — always actioned. |
| **Unknown** | anything unmatched | **Never auto-classified.** Reported to Zach in its own section; adding a new stream = adding a table row to the skill. |

Combined-doc subjects (e.g. `Customer Agreement & Installation Order Rejected by PE`) cover
multiple docs → open if ANY is open (inherited from pe-rejection-audit).

**Delegation mechanics:** the triage skill fetches and parses the email set ONCE, then applies
**pe-rejection-audit's Mode 1 step 4 classification rule only** — doc in `RESPONSE_NEEDED` → open,
else actioned, subject to the versions-after-rejection check for admin-clears — against the state
script's PE block. It does not re-run that skill's Gmail search (step 1), does not re-parse (step
2, already done), and does not run `pe-rejection-status-check.ts` (step 3, replaced by the PE
block). The cleanup preview is unified — one combined preview covering all streams, one approval —
so the same email is never fetched or previewed twice in a run.

## Blocker-topic mapping (mentions/comments)

The mention body names what is stuck. The skill extracts the topic and checks the matching live
state from the script row:

| Blocker named in the mention | Live-state check |
|---|---|
| Permit rejected / permitting stuck | `permitting_status` + permit-issued date — issued or no longer rejected → actioned |
| DA held up / DA rejected | DA status props + deal stage — DA approved/signed → actioned |
| Interconnection stuck / rejected | `interconnection_status` — approved/submitted-clean → actioned |
| PE docs / PE payment | PE API via `pe_project_id` (same checks as PE streams above) |
| Design / revision | `design_status` + revision counters — revision closed → actioned |
| Direct question to Zach, no state blocker | Zach replied on the deal AFTER the mention timestamp (HubSpot engagements/comments on the deal) → actioned. Ad-hoc skill-side lookup, not part of the script contract |
| Pure FYI ("tagging you for visibility") | Actioned |
| Topic unclear / doesn't map | **Open** (safe direction) |

The deal-state reason fields give the verbatim current "why" — if the email's complaint no longer
matches the deal's current reason (reason changed or cleared), that is the resolution signal.

## Safety rules (non-negotiable)

- **Safe error direction is KEEP.** Uncertain classification, unknown pattern, unmapped blocker,
  ambiguous state, script `notFound` → flag as open. Never auto-clean anything uncertain.
- **Auditing is read-only.** The only mutation is Gmail trash (`apply_sensitive_message_label`,
  `labelOption: TRASH`, 30-day recoverable), and only after Zach approves the previewed set.
- Never touch emails from senders other than `noreply@notifications.hubspot.com`.
- Never trash a still-open email; combined subjects stay if any covered item is open.
- PE-rejection emails are judged by `pe-rejection-audit`'s classification rule but cleaned up
  through THIS skill's unified preview — one preview, one approval, covering every stream. That
  skill's own Gmail search and separate preview/cleanup flow are not invoked during a triage run.

## Output convention

Chat summary grouped by stream, open items first: what's blocked, verbatim reason, deal owner,
HubSpot link (and PE link + $ held for PE items). Then the safe-to-trash set as counts per stream
with a sample, then wait for explicit go-ahead before trashing. Optional HTML report for big runs
(same convention as pe-rejection-audit).

## Non-goals (YAGNI)

- No cron / scheduled automation (explicitly deferred; add later on top if the triage proves
  trustworthy).
- No auto-archiving without preview, including FYIs (Zach chose preview-then-trash for everything).
- No HubSpot task mutations (that stays in `pe-rejection-audit` Mode 2).
- No handling of non-notification HubSpot corporate mail (CSM/renewal threads).

## Error handling

- Gmail/HubSpot/PE API failures: report the failure and present partial results clearly labeled as
  partial; never trash based on a partial state read.
- PE API quota (5000/day, resets 6PM MT): the script reuses the existing PE client; if quota is
  exhausted, PE-dependent streams are reported as "state unavailable — kept" rather than guessed.
- Unparseable PROJ number in a subject: email goes to the Unknown section. Most streams carry
  `PROJ-XXXX` in the subject, but mention/comment and task-assignment subjects are truncated
  (`New comments on the deal "PROJ-8732 | Mackenzie, Scott | 62 Glory Hole Dr, Breckenridge, C…"`)
  and some name a task with no PROJ at all (`Arapahoe Inspection Letters - 9932 Lane D&R`). The
  skill parses the subject first, then falls back to the deal link in the body; if neither yields
  a PROJ, the email is Unknown — never actioned.
- Gmail volume: at ~200 notifications/week the search exceeds one page (max 50 threads). The skill
  paginates via `pageToken` until the window is exhausted, and reports the total processed so a
  silently truncated run is visible.

## Testing

- Script: unit test the PROJ-input → row mapping with mocked HubSpot client (repo Jest
  conventions); verify `notFound` behavior. Also test the PE block against mocked `pe-api.ts`
  responses — `peDocs` status/`latestVersionDate` shaping, `peMilestones`, `pePayments`, and that
  a failed/quota-exhausted `listAllProjects()` sets `peUnavailable` run-wide.
- Skill: first live run is report-only against the current backlog; Zach spot-checks
  classifications before the first cleanup is approved. Subject-pattern coverage is validated
  against the last 30 days of real emails during the build.
