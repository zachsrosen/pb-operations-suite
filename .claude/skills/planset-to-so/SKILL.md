---
name: planset-to-so
description: Use when the user wants to go from a deal to a Zoho Sales Order in one flow. Triggered by "process PROJ-XXXX", "create SO for this deal", "run the full pipeline", "SO for Turner", or any request combining planset finding, BOM extraction, and SO creation.
---

# Planset to Sales Order — Single Job

End-to-end: Deal → Planset → BOM → Zoho Sales Order for one project.

**REQUIRED SUB-SKILL:** Invoke `bom-pipeline-core` for steps 1-6. This skill adds a user confirmation checkpoint before SO creation.

## Workflow

1. **Run pipeline steps 1-5** from `bom-pipeline-core` (deal → planset → BOM → customer match)
2. **Show BOM summary** — module count, battery type, racking, item count, validation status
3. **If pipeline escalates** (no PDFs, validation failure, no customer match) → ask the user
4. **Show SO preview** (see below) — this is the **one required checkpoint**
5. **On approval** → run pipeline step 6 (create SO)
6. **Report result** — SO number, unmatched items, corrections applied

## SO Preview (Step 4)

```
## SO Preview — PROJ-XXXX (Customer Name)

**Deal:** {dealname}
**Zoho Customer:** {customerName} ({customerId})
**Job Type:** {solar|battery_only|hybrid}
**Items:** {count} line items

| # | Item | Qty | Source |
|---|------|-----|--------|
| 1 | SEG Solar SEG-440... | 16 | BOM |
| 2 | Tesla Powerwall 3 | 1 | BOM |
| ... | ... | ... | ... |

**Post-processor will apply:** {count} corrections
(List key corrections: SKU swaps, additions, removals)

Create this SO? [Yes / No]
```

## What This Skill Does NOT Do

- Does not run batch analysis (use `bom-so-analysis` for that)
- Does not bypass the user confirmation before SO creation
- Does not handle PO creation (separate workflow)
