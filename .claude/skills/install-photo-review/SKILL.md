---
name: install-photo-review
description: This skill should be used when the user asks to "review install photos", "compare install to planset", "check install photos against plans", "verify installation matches plans", "install photo review for PROJ-XXXX", "do the install photos match the design", or wants to compare field installation photos with the permitted design planset. Pulls photos from Zuper job attachments (or accepts manual upload), compares against the permitted planset PDF, and outputs a pass/fail equipment match report.
version: 0.1.0
---

# Install Photo Review Skill

Compare install photos against the permitted planset to verify the correct equipment was installed.

## What This Skill Does

Takes install photos (from Zuper job attachments or manual upload) and the permitted planset PDF, then uses AI vision to cross-reference what's visible in the photos against what the planset specifies.

**Equipment categories checked:**
| Category | What's verified |
|----------|----------------|
| **modules** | Panel count, make/model from nameplate |
| **inverter** | Correct model installed (nameplate) |
| **battery** | Correct model and count, gateway present |
| **racking** | Attachment type matches roof (XR10/XR100, flashings, L-feet) |
| **electrical** | AC disconnect, conduit, breaker, backup switch |
| **labels** | NEC 690 labels, ESS warnings, rapid shutdown |

**Status per category:**
- `pass` — Equipment matches planset
- `fail` — Mismatch found (wrong model, wrong count, missing component)
- `unable_to_verify` — Not visible in photos (not a failure)

---

## Workflow

### 1. Identify the Project

Get the PROJ-XXXX deal ID from the user. Look up the HubSpot deal to get:
- Deal properties (module type/count, inverter, battery, etc.)
- Design folder URL for planset lookup

### 2. Find Install Photos

**Option A — Zuper (preferred):**
1. Look up the Zuper construction job for this deal
2. Fetch job attachments via `zuper.getJobPhotos(jobUid)`
3. Download image attachments (jpg/png/heic)

**Option B — Manual upload:**
If Zuper has no photos, ask the user to provide photo URLs or upload images.

### 3. Run the Review

Call `POST /api/install-review` with:
```json
{
  "dealId": "12345678",
  "jobUid": "optional-zuper-uid",
  "photoUrls": ["optional-fallback-urls"]
}
```

The API will:
1. Fetch the permitted planset from Google Drive
2. Upload planset + photos to Claude
3. AI compares each equipment category
4. Return structured findings

### 4. Present Results

Format the findings as a report:

```
## Install Photo Review — PROJ-XXXX (Customer Name)

Planset: stamped_plans_v3.pdf
Photos reviewed: 8

| Category   | Status | Planset Spec              | Observed                  | Notes |
|------------|--------|---------------------------|---------------------------|-------|
| modules    | PASS   | 20x REC Alpha 400W        | 20 panels visible, REC    | Count confirmed from roof photo |
| inverter   | PASS   | Tesla Inverter (PW3)      | Tesla PW3 nameplate       | Serial visible |
| battery    | PASS   | 1x Powerwall 3 (13.5kWh) | 1 PW3 unit on wall        | — |
| racking    | PASS   | IronRidge XR10            | XR10 rails visible        | Flashkit flashings confirmed |
| electrical | PASS   | AC disconnect, 30A breaker| Disconnect + breaker shown | — |
| labels     | N/A    | —                         | Not visible in photos     | unable_to_verify |

**Overall: PASS** (5 pass, 0 fail, 1 unable to verify)
```

### 5. Handle Failures

If any category is `fail`:
- Highlight the specific mismatch
- Recommend follow-up action (re-photograph, field check, designer review)
- Do NOT automatically assume the planset is correct — the install may be an approved change order

---

## API Reference

**Endpoint:** `POST /api/install-review`

**Request:**
```typescript
{
  dealId?: string;      // HubSpot deal ID (required for planset lookup)
  jobUid?: string;      // Direct Zuper job UID (optional)
  photoUrls?: string[]; // Fallback photo URLs (optional)
}
```

**Response:**
```typescript
{
  findings: Array<{
    category: "modules" | "inverter" | "battery" | "racking" | "electrical" | "labels";
    status: "pass" | "fail" | "unable_to_verify";
    planset_spec: string;
    observed: string;
    notes: string;
  }>;
  overall_pass: boolean;
  summary: string;
  photo_count: number;
  planset_filename: string;
  duration_ms: number;
}
```

---

## Tips

- More photos = better review. Aim for: roof overview, inverter nameplate, battery, electrical panel, disconnect.
- Photos with visible nameplates give the best results.
- The AI will count panels from overview photos — a clear drone/roof shot helps.
- `unable_to_verify` is expected for some categories if photos don't cover everything.
