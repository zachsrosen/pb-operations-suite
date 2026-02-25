# BOM Product Catalog & Zuper Compliance Enhancements

**Date:** 2026-02-25
**Source:** Business Process Status meeting (Feb 25)
**Target:** BOM rollout April 6; compliance improvements ASAP

---

## Workstream 1: BOM Tool — Product Catalog & Pricing

### Problem

The current product creation flow is a minimal modal (`PushToSystemsModal`) triggered only from unmatched BOM items. It captures 6 fields (brand, model, description, category, unit spec, unit label) and lacks cost/pricing data, vendor info, and a manageable approval workflow. The `EquipmentCategory` enum only covers 4 of the 8 BOM categories, so racking, electrical BOS, monitoring, and rapid shutdown items can't be tracked as SKUs.

### Schema Changes

#### Extend `EquipmentSku`

New fields:

| Field | Type | Purpose |
|-------|------|---------|
| `description` | `String?` | Human-readable product description |
| `vendorName` | `String?` | Primary vendor/supplier name |
| `vendorPartNumber` | `String?` | Vendor's part number / SKU |
| `unitCost` | `Float?` | Purchase cost per unit |
| `sellPrice` | `Float?` | Sell price per unit |
| `hubspotProductId` | `String?` | Link to HubSpot Products |
| `zuperItemId` | `String?` | Link to Zuper parts catalog |

Margin is derived: `(sellPrice - unitCost) / sellPrice * 100`. Not stored.

#### Expand `EquipmentCategory` Enum

Add: `RAPID_SHUTDOWN`, `RACKING`, `ELECTRICAL_BOS`, `MONITORING`

This allows the full BOM item set to be tracked in the catalog.

### New Dashboard: `/dashboards/product-catalog`

Three tabs:

1. **Catalog** — Searchable/filterable table of all `EquipmentSku` records. Columns: category, brand, model, description, unit cost, sell price, margin %, vendor, Zoho/HubSpot/Zuper sync status (green/gray dots). Inline editing for cost/price fields. Bulk activate/deactivate.

2. **Approval Queue** — Pending `PendingCatalogPush` requests. Shows requester, deal context, proposed data. Approve pre-fills catalog entry for review. Reject with reason.

3. **Sync Health** — Catalog completeness overview: SKUs linked to Zoho, HubSpot, Zuper. Surface items missing external IDs.

### Enhanced Product Creation Form

Full-page form accessible from:
- Catalog tab ("Add Product" button)
- BOM page unmatched items (redirect with pre-filled data)
- Approval queue (approve action opens pre-filled form)

Fields: brand, model, description, category (all 8), unit spec, unit label, vendor name, vendor part number, unit cost, sell price, target systems checkboxes.

### BOM Table Pricing Columns

When a BOM item matches a catalog SKU, show: unit cost, extended cost (qty x unit cost), sell price. Unmatched items show "—" with link to add to catalog.

---

## Workstream 2: Zuper Compliance — Data Accuracy Audit

### Issues to Fix

#### 1. Service Team 15-User Count Bug

`userCount` = `users.length` after filtering. The count likely includes users who shouldn't appear. Investigation path:
- Query `/api/zuper/compliance?team=Service` and inspect the actual user list
- Cross-reference against `compliance-team-overrides.ts` Service team mapping
- Check if `COMPLIANCE_EXCLUDED_USER_UIDS` is missing entries
- Verify `EXCLUDED_USER_NAMES` and `EXCLUDED_TEAM_PREFIXES` filters

#### 2. Completion Time Fallback

If no `completed_time` or status history entry exists, the code falls back to `scheduledEnd`, making the job silently count as "on-time." Fix: flag these as "unknown completion time" instead of counting them.

#### 3. OOW Metric Baseline

`getOnOurWayTime()` currently compares OOW time to `scheduledEnd`. Per meeting discussion, it should compare to `scheduledStart` — the question is whether crews send OOW ~15 min before the scheduled start window.

Additional issues:
- Rescheduled jobs may carry OOW timestamps from original schedule
- Need to handle OOW entries that predate the current scheduled window

#### 4. Started Timestamp Extraction

`hasStartedStatus()` is boolean-only. Need to extract the actual `created_at` timestamp and compare to the scheduled start window for a "started on time" metric.

#### 5. Roofing Categories Missing

`JOB_CATEGORY_UIDS` has 9 categories, no roofing. Fix:
- Query Zuper `list_job_categories` API for roofing UIDs
- Add to the constant map
- Compliance route auto-iterates all entries, so this is the only change needed

#### 6. Retroactive Status Updates

Crews updating Zuper after the fact means `created_at` on status entries reflects app-update time, not work time. This inflates late counts for crews with poor app discipline. Consider adding a "data confidence" indicator per user based on the gap between status timestamps and scheduled times.

### Audit Deliverables

- Fix user count bug
- Add "unknown completion time" flag
- Adjust OOW comparison to scheduled start
- Extract `startedTime` (not just boolean)
- Add roofing category UIDs
- Document retroactive-update impact

---

## Workstream 3: Weekly 7-Day Ops Email Digest

### Delivery

Automated HTML email sent weekly (Monday morning) via **Gmail API** using Google Workspace service account / stored refresh token. Sends from a real `@photonbrothers.com` address. Recipients configurable via `COMPLIANCE_REPORT_RECIPIENTS` env var, defaulting to Matt + Zach.

### Email Sections

#### 1. Header Summary — 4 Key Numbers
- Jobs Completed (7d)
- On-Time Completion %
- OOW Usage %
- Stuck Jobs Count

Each with trend arrow vs. prior 7-day period.

#### 2. Team Breakdown Table
One row per team (Centennial, Colorado Springs, D&R, SLO, Service, Westminster). Columns: completed, on-time %, avg days late, stuck, grade. Highlight best/worst.

#### 3. Category Breakdown
Row per category (Site Survey, Construction, Inspection, Service, Roofing, etc.). Same columns as team table.

#### 4. Notification Reliability
- % of jobs with OOW before scheduled start
- % of jobs with "Started" within scheduled window
- Callout for crews with <50% OOW usage

#### 5. Auto-Generated Callouts
- Stuck jobs >3 days past schedule
- Users with F grades
- Jobs with unknown completion times

### Implementation

- New `scripts/send-weekly-compliance.ts` alongside existing `send-weekly-review.ts`
- Shared data function `getComplianceDigestData(days: 7)` reusing existing compliance calculation logic
- Gmail send via `google.gmail('v1').users.messages.send()` with HTML body
- Trigger: Vercel Cron or manual `npx tsx scripts/send-weekly-compliance.ts`
