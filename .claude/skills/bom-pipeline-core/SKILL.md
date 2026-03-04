---
name: bom-pipeline-core
description: Use when running the deal-to-SO pipeline steps for any purpose — single job SO creation, batch analysis, or debugging. Covers deal lookup, planset auto-selection, BOM extraction, customer matching, and SO creation. Referenced by planset-to-so and bom-so-analysis.
---

# BOM Pipeline Core

Shared pipeline: Deal → Planset → BOM → Zoho Sales Order. This skill defines the canonical steps. Caller skills (planset-to-so, bom-so-analysis) add their own checkpoints and post-steps.

## Input

One of:
- PROJ number (e.g., "PROJ-9009")
- Customer name (e.g., "Turner")
- HubSpot deal ID

## Prerequisite: Fetch Team Feedback

Before starting the pipeline, fetch recent BOM feedback:
1. Call `GET /api/bom/feedback` (or query `BomToolFeedback` table directly)
2. Review notes — they highlight extraction gaps and SO creation issues from the ops team
3. The API extraction and SO creation paths now inject feedback automatically, but reviewing it first ensures you can flag known issues proactively

> **Note:** Feedback is injected into the extraction system prompt and SO audit trail automatically. This step is for your awareness during interactive sessions.

## Step 1: Find Deal in HubSpot

```
mcp__98214750__search_crm_objects
  objectType: deals
  query: "PROJ-9009" or "Turner"
  properties: ["dealname", "hs_object_id", "design_documents",
    "all_document_parent_folder_id", "project_number",
    "associated_contact_id", "module_count", "roof_type",
    "system_size_kwdc"]
```

**Auto-selection:** If exactly one match, use it. If multiple, pick the one whose `dealname` or `project_number` best matches the input. Only escalate to caller if truly ambiguous (2+ equally good matches).

## Step 2: Auto-Select Planset

Invoke the `find-design-plans` skill to locate PDFs.

1. Extract folder ID from `design_documents` URL
2. Call `GET /api/bom/drive-files?folderId={folderId}`
3. Auto-pick using this priority:
   - Files in a "Stamped Plans" subfolder over other locations
   - Most recently modified PDF
   - Filename containing "stamped" or "stamp" (case-insensitive) preferred
4. If only one PDF exists, use it

**Escalate to caller if:** zero PDFs found, or multiple PDFs with identical timestamps and no "stamped" signal.

Report selection: `"Using [filename] (modified [date])"`

## Step 3: Extract BOM

Invoke the `planset-bom` skill on the selected PDF.

- Run full extraction (all sheets: PV-0 header, PV-2 BOM table, PV-4 conductor schedule)
- Produce compact summary: module count, battery type, racking system, total item count
- Run validation checks (module count match, battery capacity, OCPD)

**Escalate to caller if:** any validation check fails (caller decides whether to continue or pause).

## Step 4: Save BOM Snapshot

```js
POST /api/bom/history
Body: { "dealId": "...", "dealName": "PROJ-XXXX Customer", "bomData": BOM_RESULT }
// version auto-increments per dealId
```

Capture the returned `version` number for Step 6.

## Step 5: Auto-Match Zoho Customer

```
# A: Try hubspot_contact_id match (preferred)
GET /api/bom/zoho-customers?hubspot_contact_id={contactId}

# B: Fallback — name search (first 2 words of dealname)
GET /api/bom/zoho-customers?search={customerName}
```

**Auto-selection:**
- hubspot_contact_id returns exactly one match → use it
- Name search returns exactly one match → use it
- Multiple matches → pick closest name match to dealname
- **Escalate to caller if:** zero matches found

Report selection: `"Matched to Zoho customer: [name] ([customerId])"`

## Step 6: Create Sales Order

```js
POST /api/bom/create-so
Body: { "dealId": "...", "version": SNAPSHOT_VERSION, "customerId": "..." }
```

**Response fields to capture:**
- `salesorder_number` — Zoho SO number (e.g., `SO-00456`)
- `unmatchedItems[]` — BOM items that couldn't match to Zoho inventory
- `corrections[]` — post-processor changes (sku_swap, item_removed, qty_adjust, item_added)
- `jobContext` — detected job parameters (jobType, roofType, moduleCount, etc.)

**Idempotency:** If snapshot already has `zohoSoId`, returns the existing SO (not an error).

## Error Recovery

| Error | Default Action |
|-------|---------------|
| Deal not found | Escalate — ask for correct identifier |
| No PDFs in design folder | Escalate — provide Drive folder link |
| BOM validation fails | Escalate — caller decides continue/fix |
| PDF unreadable | Log failure, escalate |
| No Zoho customer match | Escalate — caller provides customer ID |
| SO creation fails | Log error, escalate |
| Unmatched items on SO | Log them, continue (they were skipped) |

"Escalate" means return control to the calling skill — `planset-to-so` asks the user, `bom-so-analysis` logs and skips to the next job.
