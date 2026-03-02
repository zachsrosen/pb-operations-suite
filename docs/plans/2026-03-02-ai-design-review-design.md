# AI-Powered Design Review — Design Doc

**Date:** 2026-03-02
**Status:** Approved

## Problem

The review buttons on `/dashboards/reviews/[dealId]` run trivial field-presence checks (10 checks across 3 skills, all completing at 0ms). They don't actually review the design — they just verify HubSpot fields are populated. The original intent was rich Claude-powered review workflows (documented in SKILL.md files), but only scaffolding was built.

## Solution

Replace the deterministic check engine with a Claude Sonnet-powered review that reads the actual planset PDF (via vision), cross-references it against the design approval (DA) document, revision notes, and jurisdiction-specific AHJ/utility requirements from HubSpot custom objects.

## Scope Changes

| Before | After |
|--------|-------|
| 3 skills: design-review, engineering-review, sales-advisor | 1 skill: design-review |
| 10 field-presence checks, 0ms | Claude vision review, ~20-45s |
| Checks HubSpot fields only | Reads planset PDF + DA + revision notes + AHJ/utility rules |
| Deterministic pass/fail | AI-generated findings with severity levels |

**Removed:** `sales-advisor` (not relevant to design scope), `engineering-review` (merged into design-review).

## Architecture

### Data Flow

```
POST /api/reviews/run { dealId, skill: "design-review" }
  │
  ├─ 1. Fetch deal (182 properties from HubSpot)
  ├─ 2. Fetch AHJ requirements (via fetchAHJsForDeal)
  ├─ 3. Fetch utility requirements (via fetchUtilitiesForDeal)
  ├─ 4. Find planset PDF (design_documents URL → Drive API → Stamped Plans/)
  ├─ 5. Find DA document (same Drive folder → DA/ subfolder)
  ├─ 6. Find revision notes (same Drive folder, or deal properties)
  │
  ├─ 7. Claude Sonnet review (vision + structured context)
  │     Input:
  │       - Planset PDF pages as images
  │       - DA document (PDF or text)
  │       - Deal properties (equipment, system size, location)
  │       - AHJ rules (fire offsets, stamping, RSD, codes, snow/wind loads)
  │       - Utility rules (AC disconnect, backup switch, production meter, size limits)
  │       - Revision notes / DA revision counter
  │     Checks:
  │       - Planset ↔ DA match (equipment, layout, system size)
  │       - Revision compliance (changes from revision notes applied)
  │       - AHJ compliance (fire offsets, stamping, RSD, code versions)
  │       - Utility compliance (AC disconnect, meter, size rules)
  │       - Equipment match (HubSpot deal ↔ planset specs)
  │     Output:
  │       - Structured findings[] with check, severity, message, field
  │
  └─ 8. Persist to ProjectReview table, return findings
```

### API Interface

Same endpoint, same response shape — no frontend changes needed beyond button consolidation.

```
POST /api/reviews/run
Body: { dealId: string, skill: "design-review" }
Response: { id, dealId, skill, passed, errorCount, warningCount, infoCount, findings[], durationMs }
```

### Drive File Discovery

Uses the existing lookup chain from `find-design-plans` SKILL.md:

1. Fetch `design_documents` property from deal (full Drive URL)
2. Extract folder ID from URL
3. Call Drive API to list children (PDFs in Stamped Plans/, DA/ subfolders)
4. Download PDFs via service account auth (same pattern as `bom/extract` route)

Auth: Service account with domain-wide delegation (same fallback chain as BOM extract).

### AHJ/Utility Data

From `src/lib/hubspot-custom-objects.ts`:

- `fetchAHJsForDeal(dealId)` → 50+ properties including fire_offsets_required, stamping_requirements, is_rsd_required_, design_snow_load, design_wind_speed, building/electrical/fire/residential codes and notes
- `fetchUtilitiesForDeal(dealId)` → 40+ properties including ac_disconnect_required_, backup_switch_allowed_, is_production_meter_required_, system_size_rule, design_notes

These are fetched via HubSpot association lookups (deal → custom object).

### Claude API Pattern

Uses `client.beta.files.upload()` for PDF processing (same pattern as `src/lib/bom-extract.ts`), then a single `messages.create()` call with:
- System prompt defining the review rubric
- PDF file references (planset + DA)
- Text context (deal properties, AHJ rules, utility rules, revision notes)
- Structured output via tool_use for findings

Model: `claude-sonnet-4-20250514` (balances cost and quality for vision tasks).

### Cost & Latency

- **Latency:** ~20-45s per review (PDF upload + vision processing + generation)
- **Cost:** ~$0.05-0.15 per review (dependent on planset page count)
- **Acceptable:** User confirmed 10-30s latency is fine

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/reviews/run/route.ts` | Replace `runChecks()` with Claude API review pipeline |
| `src/lib/checks/types.ts` | Keep Finding/ReviewResult types, update SkillName |
| `src/lib/design-review.ts` | **NEW** — core review function (fetch data, call Claude, parse findings) |
| `src/components/ReviewActions.tsx` | Consolidate 3 buttons → 1 "Run Design Review" button |
| `src/app/dashboards/reviews/[dealId]/page.tsx` | Update skill cards (1 instead of 3) |

### Files to Remove

| File | Reason |
|------|--------|
| `src/lib/checks/design-review.ts` | Replaced by Claude-powered review |
| `src/lib/checks/engineering-review.ts` | Merged into design-review |
| `src/lib/checks/sales-advisor.ts` | Out of scope |
| `src/lib/checks/runner.ts` | No longer needed (no deterministic check loop) |
| `src/lib/checks/index.ts` | Registry no longer needed |

### Existing Code Reused

- `fetchAHJsForDeal()` / `fetchUtilitiesForDeal()` from `hubspot-custom-objects.ts`
- `getDriveToken()` pattern from `bom/extract/route.ts` (or extract to shared helper)
- `client.beta.files.upload()` pattern from `bom-extract.ts`
- `ProjectReview` Prisma model for persistence
- `logActivity()` for audit trail

## Open Questions

- **Revision notes location:** Need to confirm whether revision notes are standalone documents in Drive or embedded in deal properties (`da_revision_counter`, `total_revision_count`). May need to search Drive folder for files matching "revision" or "notes".
- **DA format:** Design Approval may be a PDF, Google Doc, or text file. Need to handle multiple formats.
- **Missing planset:** If no planset PDF found in Drive, the review should return an actionable error finding rather than failing silently.
