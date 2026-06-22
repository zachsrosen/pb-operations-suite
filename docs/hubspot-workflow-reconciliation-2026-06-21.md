# HubSpot Workflow Reconciliation — SOP vs. Live API

**Date:** 2026-06-21
**Source of truth:** HubSpot Automation v4 API (`GET /automation/v4/flows`), pulled live this session.
**Docs reconciled:** SOP "Workflows" tab in [`public/sop-guide.html`](../public/sop-guide.html) (added in commit `850c2421`).
**Raw data:** [`data/hubspot-flows/all-flows.json`](../data/hubspot-flows/all-flows.json) (933 flows), plus per-flow detail for anchor flows.

> **No HubSpot workflows were modified. No SOP content was changed.** This is a read-only reconciliation with a draft reference for review.

---

## 1. Headline numbers

| Metric | Value |
|---|---|
| Live flows (total) | **933** |
| Enabled (ON) | **736** |
| Disabled (OFF) | **197** |
| Workflows the SOP tab *claims* to cover | 171 (per commit message) / **"240+"** (per the tab's own overview text) |
| Workflows the SOP tab *actually names in tables* | **71** |

So the "171 → 933" framing is partly an artifact of how we counted. The SOP tab never enumerated 171 workflows; its tables name **71**, and its overview header says "240+ total." Neither figure was ever close to the real **933**. The reconciliation below explains where the other ~860 come from and how much is real automation vs. system/clone noise.

---

## 2. Live inventory by object type

| objectTypeId | Object | Total | ON |
|---|---|---|---|
| `0-3` | **Deal** | 826 | 663 |
| `0-1` | Contact | 66 | 45 |
| `0-5` | **Ticket** (Service / PB Support / Tech Ops pipelines) | 29 | 19 |
| `0-53` | Lead | 7 | 4 |
| `0-14` | Company | 2 | 2 |
| `0-101` | Subscription | 1 | 1 |
| `0-47` | Marketing Event | 1 | 1 |
| `2-23112972` | Custom object | 1 | 1 |
| | | **933** | **736** |

The deal pipeline (`0-3`) is **89%** of all automation. The Service pipeline is tickets pipeline id `0` within the `0-5` object (production-issue categories `hs_ticket_category` = "Production Guarantee" / "System Failure/Underperformance").

---

## 3. Live inventory by naming-convention family

First-match-wins bucketing of all 933 by name prefix / pattern. Full per-flow listings are in the companion reference: [`docs/hubspot-workflow-reference-2026-06-21.md`](hubspot-workflow-reference-2026-06-21.md).

| Family | Total | ON | OFF |
|---|---|---|---|
| **Design Flow** (`NN. Design Flow - …`, incl. revision clones) | 79 | 67 | 12 |
| **Utility / Interconnection Flow** (incl. `ZRS \| Utility Flow \|`) | 59 | 48 | 11 |
| **Date Stamp \|** (system date stamping) | 59 | 52 | 7 |
| **PTO Flow** | 41 | 36 | 5 |
| **Participate Flow** (PE) | 39 | 32 | 7 |
| **Permit Flow** | 35 | 35 | 0 |
| **DA Flow** (Design Approval) | 21 | 18 | 3 |
| **SGIP Flow** (CA storage incentive) | 18 | 16 | 2 |
| **Bot Hook \| / Bot Comms \|** (Olivia / Tech-Ops bots) | 15 | 11 | 4 |
| **Site Survey Flow** | 12 | 9 | 3 |
| **Transition \|** (stage transitions) | 11 | 8 | 3 |
| **Assignments \| / Lead routing (WMS)** | 11 | 6 | 5 |
| **Incentive Flow** | 8 | 2 | 6 |
| **Inspection Flow** | 8 | 6 | 2 |
| **Quality Flow** (90-day stuck review) | 7 | 5 | 2 |
| **Ungrouped** (ad-hoc / single-purpose / legacy named) | ~510 | ~385 | ~125 |

*(Counts shift slightly with bucket order; the reference doc uses a stable ordered bucketing. Directionally identical.)*

### Why the count is so much bigger than the docs

The gap is **not** ~860 hidden processes. It's a handful of multipliers on a modest number of real process chains:

1. **Clone families (re-enrollment workaround) — the single biggest driver.**
   HubSpot workflows can't re-enroll an object that's already passed through. For anything a deal hits repeatedly (design revisions especially), Ops clones the workflow and suffixes `(#1) (#2) (#3) (#4)`. **61 flows** carry an explicit `(#N)` / `(cloned)` marker, **58 of them ON**. Example — one logical step, "DA Revision In Progress," exists as 3 live flows:
   - `11a. Design Flow - DA Revision In Progress (#1)` (`452276354`)
   - `11a. Design Flow - DA Revision In Progress (#2)` (`1693017175`)
   - `11a. Design Flow - DA Revision In Progress (#3)` (`1693914156`)

   "As-Built Revision In Progress" has `#1`–`#4`. "Permit Design Revision In Progress" has `#1`–`#4`. Each `(#N)` is a near-identical copy. The **~25 logical Design Flow steps** balloon to **79 live flows** almost entirely through this cloning.

2. **`Date Stamp |` family (59 flows).** Pure system plumbing — one tiny workflow per "stamp `<property>` with today's date when status flips" (e.g. the PE submission-date stamps documented in memory). Real but mechanical; the SOP never listed these individually.

3. **`Participate Flow` + `SGIP Flow` (57 flows).** PE and the CA SGIP storage-incentive program are document-heavy, milestone-driven pipelines added *after* the March SOP snapshot. Each milestone/document state is its own flow.

4. **`Bot Hook |` / `Bot Comms |` (15 flows).** Caleb's Olivia bot + Zach's Tech-Ops bot integrations — post-March, undocumented in the SOP tab.

5. **Autosave / abandoned noise.** **17 flows** named `Unnamed workflow - <timestamp>` (HubSpot autosaves of never-finished edits) and **3** prefixed `(Turned Off)`. Pure cruft — candidates for deletion, not documentation.

**Bottom line:** of 933 flows, realistically **~150–200 distinct logical processes**. The rest is clone fan-out (~60+), date-stamp plumbing (~59), and autosave noise (~20). The "real automation" surface is much closer to the SOP's "240+" estimate than to 933.

---

## 4. Drift report

### 4a. Documented → now OFF (process changed, doc stale)

Of the **71** workflows named in the SOP tables, **64 matched** a live flow and **9 of those are now disabled** (process retired or replaced, doc still shows them as live):

| SOP table name | Live flow it maps to | State |
|---|---|---|
| `Submit Xcel PTO Photos at Inspection` | same | ⚪ OFF |
| `08. Revision Returned From Design` | `(Turned Off) Design Flow - Design Revision Returned From Designers` | ⚪ OFF |
| `01. Quality Flow - Review Needed` | same | ⚪ OFF |
| `02a - Survey Scheduled` | `04. Site Survey Flow - Survey Scheduled` | ⚪ OFF |
| `Design Approved` | `Design Lead - Design Approved - WMS` | ⚪ OFF (replaced by `04. Design Flow` node) |
| `04 - Permit Issued` | `Precon Lead - Permit Issued - WMS` | ⚪ OFF (replaced by Permit Flow node) |

> Several "WMS" / "- Lead -" named flows that the SOP documents have been **superseded by the `NN. <Stage> Flow` re-numbered family** and switched OFF. The SOP tab predates the renumbering.

### 4b. Documented → no live match (renamed or deleted)

**7** SOP-named workflows have no clean live counterpart — likely renamed under the `ZRS |` / `WMS` / `NN.` conventions or deleted:

`01a - Ready for Survey` · `02b - Survey Scheduled SMS` · `02c - Survey Scheduled Email` · `04 - Waiting on Change Order` · `DA Revision Needed` · `Xcel Site Plan & SLD Needed` · `07a - Xcel Photo Start`

*(Some almost certainly still exist under a prefixed name — e.g. `Ready for Survey` → `04. Site Survey Flow | 01a - Ready`. These need a human eyeball during the SOP refresh; auto-matching can't confirm the rename.)*

### 4c. Live → undocumented (whole families missing from the SOP)

Entire families exist live but are **absent from the SOP Workflows tab** (all added after the March 2026 snapshot):

- **Participate Energy (39)** — the entire PE milestone + rejection automation, including the rejection-notes webhooks `1839840408` (M1) and `1839840409` (M2).
- **SGIP Flow (18)** — California storage incentive pipeline.
- **Bot Hook / Bot Comms (15)** — Olivia + Tech-Ops bot integrations.
- **Date Stamp (59)** — system date stamping (arguably should stay as a single summary row, not 59 entries).
- **EagleView / TrueDesign Design Flow nodes** — `Design Flow: Eagleview Ready for Review / Reviewed / Failed`, `Design Flow: Download TrueDesign Files`, `Design Flow - Survey Revisit Needed`, `Design Flow - IDR Revision …`.
- **`(NEW) HS Ticket → Zuper`** and the `[PB Ops] Ticket Created → Property Sync` ticket flows.

---

## 5. Key process chains (verified against live flow detail)

### Design Flow — stage progression (deals, `0-3`)
Linear `NN.` numbered chain, each node enrolls on a `dealstage` / design-status change and advances the next:
`00. Ready for Design → 01. Design In Progress → 02. Uploaded / Ready for Review → 03. Initial Review Complete → 04. DA Approved / Final Design Review → 05. Final Review Complete → 06. Stamps in Progress → 07. Stamped Plans Uploaded / Design Complete`.
Branches off the spine: `08x` New Construction, `09x` Xcel design, `10x` rejections (DA / AHJ / Utility, with `2nd`-time variants), `11x` revision-in-progress, `12x` revision-complete — each revision lane cloned `(#1)`–`(#4)` for re-entry. Terminal: `Design Flow - Project Complete` (`559307102`).

### Production Guarantee check → tag (deals, `0-3`)  *(verified detail)*
`180 Day Production Guarantee Check` (`1628408614`, ON) and `1 Year Production Guarantee Check` (`1628410720`, ON):
- **Enroll:** `tags IS_ANY_OF ['PB Advantage']` **AND** `pto_completion_date` is before (180d / 1yr ago) **AND** `dealstage IS_NONE_OF ['68229433']` (not closed-lost).
- **Action:** `STATIC_BRANCH` → tag the deal (`Production Issue - 180 Days` / `- 1 Year` per CLAUDE.md/memory) and spin the service follow-up. The `30 Day Production Guarantee Check` (`1628403234`) is **OFF**.

### PE rejection webhooks (deals, `0-3`)  *(verified detail)*
- `1839840408` (ON): enroll `pe_m1_status IS_ANY_OF ['Rejected']` → single **WEBHOOK** action (to the PB Ops rejection-notes endpoint).
- `1839840409` (ON): enroll `pe_m2_status = Rejected` → single **WEBHOOK**.
Matches the documented PE rejection-notes feature (flows 1839840408/409, per memory `project_pe_rejection_notes_feature`).

### Service pipeline (tickets, `0-5`)
29 ticket flows. Active spine: `Ticket Acknowledgement` → `Stuck in Acknowledgement` → `Ticket Assignments - Service` / `- IT Support` → `(NEW) HS Ticket → Zuper [Creation, Updates]` → `Service - Post Site Visit Follow-Up Task`. Design-on-ticket sub-flow: `Design Needed/In Progress/Ready for Review (Ticket)`. Property sync: `[PB Ops] Ticket Created → Property Sync`. **Legacy OFF:** the old `PB Support:` / `Service Pipeline:` / `Technical Operations Pipeline:` email-status flows, `Ticket Kickoff`, `Ticket to Zuper Job & Project`, `Link Ticket to Zuper Job`.

---

## 6. Recommended next steps (for Zach's review — not yet actioned)

1. **Refresh the SOP Workflows tab** from [`hubspot-workflow-reference-2026-06-21.md`](hubspot-workflow-reference-2026-06-21.md). Drop the stale "171 / 240+" header; the real number is 933 raw / ~150–200 logical.
2. **Collapse clone families in the doc** — document "DA Revision In Progress" once, note "(cloned `#1`–`#3` for re-enrollment)". Don't list every `(#N)`.
3. **Add the missing families** — PE, SGIP, Bot, EagleView/TrueDesign, Date Stamp (as one summary row).
4. **Hand off a cleanup list to whoever owns HubSpot automation:** 17 `Unnamed workflow - <ts>` autosaves + 3 `(Turned Off)` + the documented-but-OFF WMS duplicates are deletion candidates.
5. **Confirm the 7 "no live match" renames** (§4b) with a human before deleting their SOP rows — most are probably renamed, not gone.
