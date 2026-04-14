# IDR Pricing Breakdown & Adders Checklist — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an adders checklist and pricing breakdown to the IDR meeting ProjectDetail view so the team can track site/roof conditions and validate deal pricing during meetings.

**Architecture:** Two new React components (`AddersChecklist`, `PricingBreakdown`) in the right column of `ProjectDetail.tsx`. Adder state persists to `IdrMeetingItem` + `IdrEscalationQueue` via existing PATCH/prep pipelines. Pricing is computed client-side using the existing `calcPrice()` engine fed by HubSpot line items. Both sync to HubSpot on manual and session-complete auto-sync.

**Tech Stack:** Next.js 16, React 19, Prisma 7.3, TypeScript 5, TanStack Query v5

**Spec:** `docs/superpowers/specs/2026-04-13-idr-pricing-adders-design.md`

---

## Chunk 1: Schema & Pipeline Plumbing

### Task 1: Prisma Migration — Add adder fields to both models

**Files:**
- Modify: `prisma/schema.prisma:1905-1987` (IdrMeetingItem model)
- Modify: `prisma/schema.prisma:2006-2040` (IdrEscalationQueue model)

- [ ] **Step 1: Add fields to IdrMeetingItem model**

In `prisma/schema.prisma`, add after line 1971 (`shitShowReason   String?`):

```prisma
  // Adder checkboxes
  adderTileRoof     Boolean  @default(false)
  adderMetalRoof    Boolean  @default(false)
  adderFlatFoamRoof Boolean  @default(false)
  adderShakeRoof    Boolean  @default(false)
  adderSteepPitch   Boolean  @default(false)
  adderTwoStorey    Boolean  @default(false)
  adderTrenching    Boolean  @default(false)
  adderGroundMount  Boolean  @default(false)
  adderMpuUpgrade   Boolean  @default(false)
  adderEvCharger    Boolean  @default(false)
  customAdders      Json     @default("[]")
```

- [ ] **Step 2: Add identical fields to IdrEscalationQueue model**

In `prisma/schema.prisma`, add after line 2035 (`conclusion           String?`):

```prisma
  // Adder checkboxes (carried over from prep/skip)
  adderTileRoof     Boolean  @default(false)
  adderMetalRoof    Boolean  @default(false)
  adderFlatFoamRoof Boolean  @default(false)
  adderShakeRoof    Boolean  @default(false)
  adderSteepPitch   Boolean  @default(false)
  adderTwoStorey    Boolean  @default(false)
  adderTrenching    Boolean  @default(false)
  adderGroundMount  Boolean  @default(false)
  adderMpuUpgrade   Boolean  @default(false)
  adderEvCharger    Boolean  @default(false)
  customAdders      Json     @default("[]")
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-idr-adder-fields
```

Expected: Migration creates 11 columns on each table, all with defaults. No data loss.

- [ ] **Step 4: Verify Prisma client generates correctly**

Run: `npx prisma generate`

Expected: No errors. `src/generated/prisma` updated with new fields.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(idr): add adder fields to IdrMeetingItem and IdrEscalationQueue"
```

---

### Task 2: Update IdrItem TypeScript interface

**Files:**
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx:30-93`

- [ ] **Step 1: Add adder fields to the IdrItem interface**

After `shitShowReason: string | null;` (approx line 82), add:

```typescript
  // Adder checkboxes
  adderTileRoof: boolean;
  adderMetalRoof: boolean;
  adderFlatFoamRoof: boolean;
  adderShakeRoof: boolean;
  adderSteepPitch: boolean;
  adderTwoStorey: boolean;
  adderTrenching: boolean;
  adderGroundMount: boolean;
  adderMpuUpgrade: boolean;
  adderEvCharger: boolean;
  customAdders: Array<{ name: string; amount: number }>;
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: Type errors in files that construct IdrItem objects without the new fields (preview route, session route). These will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/IdrMeetingClient.tsx
git commit -m "feat(idr): add adder fields to IdrItem interface"
```

---

### Task 3: Update EDITABLE_FIELDS and PREP_FIELDS whitelists

**Files:**
- Modify: `src/app/api/idr-meeting/items/[id]/route.ts:7-14`
- Modify: `src/app/api/idr-meeting/prep/route.ts:15-21`

- [ ] **Step 1: Add adder fields to EDITABLE_FIELDS**

In `src/app/api/idr-meeting/items/[id]/route.ts`, update the `EDITABLE_FIELDS` array (lines 7-14) to include:

```typescript
const EDITABLE_FIELDS = [
  "difficulty", "installerCount", "installerDays", "electricianCount",
  "electricianDays", "discoReco", "interiorAccess", "needsSurveyInfo",
  "needsResurvey", "salesChangeRequested", "salesChangeNotes", "opsChangeNotes",
  "customerNotes",
  "operationsNotes", "designNotes", "conclusion", "sortOrder",
  "escalationReason", "type", "reviewed", "shitShowFlagged", "shitShowReason",
  // Adders
  "adderTileRoof", "adderMetalRoof", "adderFlatFoamRoof", "adderShakeRoof",
  "adderSteepPitch", "adderTwoStorey", "adderTrenching", "adderGroundMount",
  "adderMpuUpgrade", "adderEvCharger", "customAdders",
];
```

- [ ] **Step 2: Add customAdders validation to the PATCH handler**

In the same file, in the PATCH handler body (after the field whitelist filtering), add validation before the Prisma update:

```typescript
// Validate customAdders if present
if (data.customAdders !== undefined) {
  if (!Array.isArray(data.customAdders)) {
    return NextResponse.json({ error: "customAdders must be an array" }, { status: 400 });
  }
  if (data.customAdders.length > 20) {
    return NextResponse.json({ error: "Maximum 20 custom adders" }, { status: 400 });
  }
  for (const adder of data.customAdders) {
    if (!adder.name || typeof adder.name !== "string" || adder.name.length > 100) {
      return NextResponse.json({ error: "Each custom adder must have a name (max 100 chars)" }, { status: 400 });
    }
    if (typeof adder.amount !== "number" || !isFinite(adder.amount)) {
      return NextResponse.json({ error: "Each custom adder must have a numeric amount" }, { status: 400 });
    }
  }
}
```

- [ ] **Step 3: Add adder fields to PREP_FIELDS**

In `src/app/api/idr-meeting/prep/route.ts`, update `PREP_FIELDS` (lines 15-21):

```typescript
const PREP_FIELDS = [
  "difficulty", "installerCount", "installerDays", "electricianCount",
  "electricianDays", "discoReco", "interiorAccess",
  "needsSurveyInfo", "needsResurvey", "salesChangeRequested",
  "salesChangeNotes", "opsChangeNotes",
  "customerNotes", "operationsNotes", "designNotes", "conclusion",
  // Adders
  "adderTileRoof", "adderMetalRoof", "adderFlatFoamRoof", "adderShakeRoof",
  "adderSteepPitch", "adderTwoStorey", "adderTrenching", "adderGroundMount",
  "adderMpuUpgrade", "adderEvCharger", "customAdders",
] as const;
```

- [ ] **Step 4: Add the same customAdders validation to the prep PATCH handler**

Same validation logic as Step 2, added to the prep route's update handler.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/idr-meeting/items/[id]/route.ts src/app/api/idr-meeting/prep/route.ts
git commit -m "feat(idr): add adder fields to EDITABLE_FIELDS and PREP_FIELDS whitelists"
```

---

### Task 4: Update pickPrepFields, preview merge, and skip/re-queue

**Files:**
- Modify: `src/app/api/idr-meeting/sessions/route.ts:111-128` (pickPrepFields)
- Modify: `src/app/api/idr-meeting/preview/route.ts:49-92` (preview merge)
- Modify: `src/app/api/idr-meeting/items/[id]/route.ts:94-119` (DELETE re-queue)

- [ ] **Step 1: Add adder fields to pickPrepFields()**

In `src/app/api/idr-meeting/sessions/route.ts`, extend `pickPrepFields()` (lines 111-128) to include:

```typescript
  ...(q.adderTileRoof ? { adderTileRoof: q.adderTileRoof } : {}),
  ...(q.adderMetalRoof ? { adderMetalRoof: q.adderMetalRoof } : {}),
  ...(q.adderFlatFoamRoof ? { adderFlatFoamRoof: q.adderFlatFoamRoof } : {}),
  ...(q.adderShakeRoof ? { adderShakeRoof: q.adderShakeRoof } : {}),
  ...(q.adderSteepPitch ? { adderSteepPitch: q.adderSteepPitch } : {}),
  ...(q.adderTwoStorey ? { adderTwoStorey: q.adderTwoStorey } : {}),
  ...(q.adderTrenching ? { adderTrenching: q.adderTrenching } : {}),
  ...(q.adderGroundMount ? { adderGroundMount: q.adderGroundMount } : {}),
  ...(q.adderMpuUpgrade ? { adderMpuUpgrade: q.adderMpuUpgrade } : {}),
  ...(q.adderEvCharger ? { adderEvCharger: q.adderEvCharger } : {}),
  ...(Array.isArray(q.customAdders) && q.customAdders.length > 0 ? { customAdders: q.customAdders } : {}),
```

- [ ] **Step 2: Add adder fields to preview merge path**

In `src/app/api/idr-meeting/preview/route.ts`, there are **two** item-construction blocks that need adder fields:

**Block 1 — IDR items (after line 78, `conclusion: prep?.conclusion ?? null,`):**

```typescript
      adderTileRoof: prep?.adderTileRoof ?? false,
      adderMetalRoof: prep?.adderMetalRoof ?? false,
      adderFlatFoamRoof: prep?.adderFlatFoamRoof ?? false,
      adderShakeRoof: prep?.adderShakeRoof ?? false,
      adderSteepPitch: prep?.adderSteepPitch ?? false,
      adderTwoStorey: prep?.adderTwoStorey ?? false,
      adderTrenching: prep?.adderTrenching ?? false,
      adderGroundMount: prep?.adderGroundMount ?? false,
      adderMpuUpgrade: prep?.adderMpuUpgrade ?? false,
      adderEvCharger: prep?.adderEvCharger ?? false,
      customAdders: (prep?.customAdders as Array<{ name: string; amount: number }>) ?? [],
```

**Block 2 — Escalation items (after line 145, `conclusion: esc.conclusion ?? null,`):**

```typescript
          adderTileRoof: esc.adderTileRoof ?? false,
          adderMetalRoof: esc.adderMetalRoof ?? false,
          adderFlatFoamRoof: esc.adderFlatFoamRoof ?? false,
          adderShakeRoof: esc.adderShakeRoof ?? false,
          adderSteepPitch: esc.adderSteepPitch ?? false,
          adderTwoStorey: esc.adderTwoStorey ?? false,
          adderTrenching: esc.adderTrenching ?? false,
          adderGroundMount: esc.adderGroundMount ?? false,
          adderMpuUpgrade: esc.adderMpuUpgrade ?? false,
          adderEvCharger: esc.adderEvCharger ?? false,
          customAdders: (esc.customAdders as Array<{ name: string; amount: number }>) ?? [],
```

Without Block 2, escalation items in preview mode lose their adder data.

- [ ] **Step 3: Add adder fields to DELETE handler re-queue**

In `src/app/api/idr-meeting/items/[id]/route.ts`, in the `prisma.idrEscalationQueue.create` call (lines 94-119), add after `conclusion: item.conclusion,` (line 118):

```typescript
          adderTileRoof: item.adderTileRoof,
          adderMetalRoof: item.adderMetalRoof,
          adderFlatFoamRoof: item.adderFlatFoamRoof,
          adderShakeRoof: item.adderShakeRoof,
          adderSteepPitch: item.adderSteepPitch,
          adderTwoStorey: item.adderTwoStorey,
          adderTrenching: item.adderTrenching,
          adderGroundMount: item.adderGroundMount,
          adderMpuUpgrade: item.adderMpuUpgrade,
          adderEvCharger: item.adderEvCharger,
          customAdders: item.customAdders,
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors related to adder fields.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/idr-meeting/sessions/route.ts src/app/api/idr-meeting/preview/route.ts src/app/api/idr-meeting/items/[id]/route.ts
git commit -m "feat(idr): wire adder fields through prep, preview, and skip/re-queue paths"
```

---

### Task 5: Update HubSpot sync — manual and auto-sync

**Files:**
- Modify: `src/lib/idr-meeting.ts:214-235` (NoteFields interface)
- Modify: `src/lib/idr-meeting.ts:238-276` (buildHubSpotNoteBody)
- Modify: `src/lib/idr-meeting.ts:287-332` (PropertyFields + buildHubSpotPropertyUpdates)
- Modify: `src/app/api/idr-meeting/items/[id]/sync/route.ts:39-93` (manual sync)
- Modify: `src/app/api/idr-meeting/sessions/[id]/route.ts:82-123` (auto-sync)

- [ ] **Step 1: Add adder fields to NoteFields interface**

In `src/lib/idr-meeting.ts`, add to the `NoteFields` interface (after line 234, `needsResurvey`):

```typescript
  // Adders (for note body display)
  adderSummary?: string | null;
```

- [ ] **Step 2: Add adder summary to buildHubSpotNoteBody()**

In `buildHubSpotNoteBody()`, after the `needsResurvey` line (line 271), add:

```typescript
  if (fields.adderSummary) lines.push(`<strong>Adders:</strong> ${esc(fields.adderSummary)}`);
```

- [ ] **Step 3: Add idr_adders to PropertyFields and buildHubSpotPropertyUpdates()**

In `src/lib/idr-meeting.ts`, add to `PropertyFields` interface (after line 300, `opsChangeNotes`):

```typescript
  adderSummary?: string | null;
```

In `buildHubSpotPropertyUpdates()`, after line 329 (`opsChangeNotes`), add:

```typescript
  if (fields.adderSummary) updates.idr_adders = fields.adderSummary;
```

- [ ] **Step 4: Create a helper to serialize adder state to a human-readable string**

In `src/lib/idr-meeting.ts`, add a new exported function:

```typescript
/** Serialize adder checkbox + custom adder state into a human-readable summary string. */
export function serializeAdderSummary(item: {
  adderTileRoof: boolean;
  adderMetalRoof: boolean;
  adderFlatFoamRoof: boolean;
  adderShakeRoof: boolean;
  adderSteepPitch: boolean;
  adderTwoStorey: boolean;
  adderTrenching: boolean;
  adderGroundMount: boolean;
  adderMpuUpgrade: boolean;
  adderEvCharger: boolean;
  customAdders: unknown;
}): string | null {
  const parts: string[] = [];
  if (item.adderTileRoof) parts.push("Tile roof");
  if (item.adderMetalRoof) parts.push("Metal roof");
  if (item.adderFlatFoamRoof) parts.push("Flat/foam roof");
  if (item.adderShakeRoof) parts.push("Shake roof");
  if (item.adderSteepPitch) parts.push("Steep pitch");
  if (item.adderTwoStorey) parts.push("2+ storey");
  if (item.adderTrenching) parts.push("Trenching");
  if (item.adderGroundMount) parts.push("Ground mount");
  if (item.adderMpuUpgrade) parts.push("MPU/svc upgrade");
  if (item.adderEvCharger) parts.push("EV charger install");
  const customs = Array.isArray(item.customAdders) ? item.customAdders : [];
  for (const c of customs) {
    if (c && typeof c === "object" && "name" in c) {
      const amt = typeof c.amount === "number"
        ? ` (${c.amount < 0 ? "-" : ""}$${Math.abs(c.amount).toLocaleString()})`
        : "";
      parts.push(`${c.name}${amt}`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
```

- [ ] **Step 5: Wire adderSummary into the manual sync route**

In `src/app/api/idr-meeting/items/[id]/sync/route.ts`, import `serializeAdderSummary` and pass `adderSummary` to both `buildHubSpotPropertyUpdates` (line 39) and `buildHubSpotNoteBody` (line 73):

Add to both field objects:
```typescript
    adderSummary: serializeAdderSummary(item),
```

- [ ] **Step 6: Wire adderSummary into the session-complete auto-sync**

In `src/app/api/idr-meeting/sessions/[id]/route.ts`, import `serializeAdderSummary` and add to both the `buildHubSpotPropertyUpdates` call (line 82) and `buildHubSpotNoteBody` call (line 103):

```typescript
      adderSummary: serializeAdderSummary(item),
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/idr-meeting.ts src/app/api/idr-meeting/items/[id]/sync/route.ts src/app/api/idr-meeting/sessions/[id]/route.ts
git commit -m "feat(idr): sync adder summary to HubSpot on manual and auto-sync"
```

---

## Chunk 2: UI Components

### Task 6: Widen lineItemsQuery type assertion

**Files:**
- Modify: `src/app/dashboards/idr-meeting/ProjectDetail.tsx:53-62`

- [ ] **Step 1: Update the type assertion to include sku**

In `ProjectDetail.tsx`, change the lineItemsQuery type (line 58) from:

```typescript
return res.json() as Promise<{ lineItems: Array<{ name: string; quantity: number; manufacturer: string; productCategory: string }> }>;
```

to:

```typescript
return res.json() as Promise<{ lineItems: Array<{ name: string; quantity: number; manufacturer: string; productCategory: string; sku: string; price: number; amount: number }> }>;
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/idr-meeting/ProjectDetail.tsx
git commit -m "feat(idr): widen lineItemsQuery type to include sku, price, amount"
```

---

### Task 7: Build AddersChecklist component

**Files:**
- Create: `src/app/dashboards/idr-meeting/AddersChecklist.tsx`

- [ ] **Step 1: Create the component file**

```typescript
"use client";

import type { IdrItem } from "./IdrMeetingClient";
import { useState } from "react";

const ROOF_ADDER_KEYS = [
  "adderTileRoof",
  "adderMetalRoof",
  "adderFlatFoamRoof",
  "adderShakeRoof",
] as const;

const ROOF_LABELS: Record<(typeof ROOF_ADDER_KEYS)[number], string> = {
  adderTileRoof: "Tile roof",
  adderMetalRoof: "Metal roof",
  adderFlatFoamRoof: "Flat/foam",
  adderShakeRoof: "Shake",
};

const ROOF_OTHER = [
  { key: "adderSteepPitch" as const, label: "Steep pitch" },
  { key: "adderTwoStorey" as const, label: "2+ storey" },
];

const SITE_ADDERS = [
  { key: "adderTrenching" as const, label: "Trenching" },
  { key: "adderGroundMount" as const, label: "Ground mount" },
  { key: "adderMpuUpgrade" as const, label: "MPU / svc upgrade" },
  { key: "adderEvCharger" as const, label: "EV charger install" },
];

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

export function AddersChecklist({ item, onChange, readOnly }: Props) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const handleRoofChange = (key: (typeof ROOF_ADDER_KEYS)[number], checked: boolean) => {
    // Mutually exclusive: send all four roof fields, only the selected one true
    const updates: Partial<IdrItem> = {};
    for (const k of ROOF_ADDER_KEYS) {
      (updates as Record<string, boolean>)[k] = k === key ? checked : false;
    }
    onChange(updates);
  };

  const handleBoolChange = (key: string, checked: boolean) => {
    onChange({ [key]: checked } as Partial<IdrItem>);
  };

  const customs = Array.isArray(item.customAdders) ? item.customAdders : [];

  const handleAddCustom = () => {
    const name = newName.trim();
    const amount = parseFloat(newAmount);
    if (!name || !isFinite(amount)) return;
    onChange({ customAdders: [...customs, { name, amount }] });
    setNewName("");
    setNewAmount("");
  };

  const handleRemoveCustom = (index: number) => {
    onChange({ customAdders: customs.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      {/* Roof */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Roof</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {ROOF_ADDER_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item[key]}
                onChange={(e) => handleRoofChange(key, e.target.checked)}
                disabled={readOnly}
                className="accent-orange-500"
              />
              {ROOF_LABELS[key]}
            </label>
          ))}
          {ROOF_OTHER.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item[key]}
                onChange={(e) => handleBoolChange(key, e.target.checked)}
                disabled={readOnly}
                className="accent-orange-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Site */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Site</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {SITE_ADDERS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item[key]}
                onChange={(e) => handleBoolChange(key, e.target.checked)}
                disabled={readOnly}
                className="accent-orange-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Custom */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Custom</p>
        {customs.length > 0 && (
          <div className="space-y-1 mb-2">
            {customs.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-foreground">{c.name}</span>
                <span className="text-muted ml-auto">${c.amount.toLocaleString()}</span>
                {!readOnly && (
                  <button
                    onClick={() => handleRemoveCustom(i)}
                    className="text-muted hover:text-foreground transition-colors"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!readOnly && (
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Adder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground placeholder:text-muted"
              maxLength={100}
            />
            <input
              type="number"
              placeholder="$"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-16 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground placeholder:text-muted"
            />
            <button
              onClick={handleAddCustom}
              disabled={!newName.trim() || !newAmount}
              className="rounded bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/idr-meeting/AddersChecklist.tsx
git commit -m "feat(idr): add AddersChecklist component"
```

---

### Task 8: Build PricingBreakdown component

**Files:**
- Create: `src/app/dashboards/idr-meeting/PricingBreakdown.tsx`

- [ ] **Step 1: Create the component file**

```typescript
"use client";

import { useMemo } from "react";
import type { IdrItem } from "./IdrMeetingClient";
import {
  calcPrice,
  matchLineItemToEquipment,
  EQUIPMENT_CATALOG,
  LOCATION_SCHEME,
  type CalcInput,
  type CalcBreakdown,
  type EquipmentSelection,
} from "@/lib/pricing-calculator";
import { normalizeLocation } from "@/lib/locations";

interface LineItem {
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
}

interface Props {
  item: IdrItem;
  lineItems: LineItem[] | undefined;
}

/** Map adder checkboxes to calculator roofTypeId. Mutually exclusive — first match wins. */
function resolveRoofTypeId(item: IdrItem): string {
  if (item.adderTileRoof) return "tile";
  if (item.adderMetalRoof) return "metal";
  if (item.adderFlatFoamRoof) return "flat";
  if (item.adderShakeRoof) return "shake";
  return "comp";
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function PricingBreakdown({ item, lineItems }: Props) {
  const result = useMemo(() => {
    if (!lineItems || lineItems.length === 0) return null;

    // Match line items to equipment catalog
    const modules: EquipmentSelection[] = [];
    const inverters: EquipmentSelection[] = [];
    const batteries: EquipmentSelection[] = [];
    const otherEquip: EquipmentSelection[] = [];
    const unmatched: string[] = [];

    for (const li of lineItems) {
      const code = matchLineItemToEquipment(li.name, li.sku, li.productCategory, li.manufacturer);
      if (!code) {
        unmatched.push(li.name);
        continue;
      }
      const eq = EQUIPMENT_CATALOG.find((e) => e.code === code);
      if (!eq) { unmatched.push(li.name); continue; }
      const sel = { code, qty: li.quantity };
      switch (eq.category) {
        case "module": modules.push(sel); break;
        case "inverter": inverters.push(sel); break;
        case "battery": batteries.push(sel); break;
        default: otherEquip.push(sel); break;
      }
    }

    // Resolve pricing scheme from location
    const normalized = normalizeLocation(item.region);
    const schemeId = normalized ? (LOCATION_SCHEME[normalized] ?? "base") : "base";
    const locationWarning = !normalized ? "Unknown location — using default pricing scheme" : null;

    // Custom adder total
    const customs = Array.isArray(item.customAdders) ? item.customAdders : [];
    const customTotal = customs.reduce(
      (sum: number, c: { amount?: number }) => sum + (typeof c.amount === "number" ? c.amount : 0),
      0,
    );

    const input: CalcInput = {
      modules,
      inverters,
      batteries,
      otherEquip,
      pricingSchemeId: schemeId,
      roofTypeId: resolveRoofTypeId(item),
      storeyId: item.adderTwoStorey ? "2" : "1",
      pitchId: item.adderSteepPitch ? "steep1" : "none",
      activeAdderIds: [],
      customFixedAdder: customTotal,
    };

    const breakdown = calcPrice(input);
    return { breakdown, unmatched, locationWarning };
  }, [item, lineItems]);

  if (!lineItems) {
    return <div className="h-5 w-48 rounded bg-surface-2 animate-pulse" />;
  }
  if (lineItems.length === 0) {
    return <p className="text-xs text-muted">No equipment data available</p>;
  }
  if (!result) return null;

  const { breakdown, unmatched, locationWarning } = result;
  const ppw = breakdown.totalWatts > 0 ? breakdown.finalPrice / breakdown.totalWatts : 0;
  const delta = (item.dealAmount ?? 0) - breakdown.finalPrice;
  const deltaPct = item.dealAmount ? Math.abs(delta / item.dealAmount) * 100 : null;
  const isPeTag = item.tags?.some((t) => t.toLowerCase().includes("participate"));

  let deltaColor = "text-emerald-400";
  let deltaBg = "bg-emerald-500/10 border-emerald-500/30";
  if (deltaPct !== null && deltaPct >= 15) {
    deltaColor = "text-red-400";
    deltaBg = "bg-red-500/10 border-red-500/30";
  } else if (deltaPct !== null && deltaPct >= 5) {
    deltaColor = "text-yellow-400";
    deltaBg = "bg-yellow-500/10 border-yellow-500/30";
  }

  return (
    <div className="space-y-3">
      {locationWarning && (
        <p className="text-[10px] text-yellow-400">{locationWarning}</p>
      )}

      {/* Cost breakdown */}
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        <Row label="Equipment COGS" value={fmt(breakdown.cogs)} />
        <Row label="Labour" value={fmt(breakdown.labour)} />
        <Row label="Acquisition" value={fmt(breakdown.acquisition)} />
        <Row label="Fulfillment" value={fmt(breakdown.fulfillment)} />
        <Row label="Adders" value={fmt(breakdown.extraCosts + breakdown.fixedAdderTotal)} />
        <div className="col-span-2 border-t border-t-border my-1" />
        <Row label="Total Cost" value={fmt(breakdown.totalCosts)} bold />
        <Row label={`Markup (${breakdown.markupPct}%)`} value={fmt(breakdown.basePrice - breakdown.totalCosts)} />
        <div className="col-span-2 border-t border-t-border my-1" />
        <Row label="Calculated Price" value={fmt(breakdown.finalPrice)} bold />
      </div>

      {/* System metrics */}
      <div className="rounded bg-surface-2/80 p-2">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
          <Row label="PPW (price/watt)" value={`$${ppw.toFixed(2)}/W`} />
          <Row label="System Size" value={`${(breakdown.totalWatts / 1000).toFixed(1)} kW`} />
        </div>
      </div>

      {/* Mismatch comparison */}
      <div className={`rounded border p-2 ${deltaBg}`}>
        <div className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs ${deltaColor}`}>
          <Row label="Calculator" value={fmt(breakdown.finalPrice)} />
          <Row label="HubSpot Deal" value={item.dealAmount ? fmt(item.dealAmount) : "N/A"} />
          <div className="col-span-2 border-t border-current/20 my-1" />
          <Row
            label="Delta"
            value={
              item.dealAmount
                ? `${delta >= 0 ? "+" : ""}${fmt(delta)} (${deltaPct!.toFixed(1)}%)`
                : "N/A"
            }
            bold
          />
        </div>
        {isPeTag && (
          <p className="text-[10px] mt-1.5 opacity-70">PE/org-level adders not included</p>
        )}
      </div>

      {/* Unmatched items */}
      {unmatched.length > 0 && (
        <div className="text-[10px] text-yellow-400">
          <p className="font-medium">{unmatched.length} item{unmatched.length > 1 ? "s" : ""} not matched to pricing catalog:</p>
          <ul className="mt-0.5 list-disc list-inside">
            {unmatched.map((name, i) => <li key={i}>{name}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <>
      <span className={bold ? "font-semibold" : ""}>{label}</span>
      <span className={`text-right ${bold ? "font-semibold" : ""}`}>{value}</span>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/idr-meeting/PricingBreakdown.tsx
git commit -m "feat(idr): add PricingBreakdown component with mismatch detection"
```

---

### Task 9: Integrate both components into ProjectDetail

**Files:**
- Modify: `src/app/dashboards/idr-meeting/ProjectDetail.tsx`

- [ ] **Step 1: Add imports**

Add at the top of `ProjectDetail.tsx`:

```typescript
import { AddersChecklist } from "./AddersChecklist";
import { PricingBreakdown } from "./PricingBreakdown";
```

- [ ] **Step 2: Add sections to the right column**

In the right column `<div>`, after the Meeting Notes section and before the AHJ & Utility Codes section, add:

```tsx
            <Section title="Adders Checklist">
              <AddersChecklist item={item} onChange={handleFieldChange} readOnly={readOnly} />
            </Section>

            <Section title="Pricing Breakdown">
              <PricingBreakdown item={item} lineItems={lineItemsQuery.data?.lineItems} />
            </Section>
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Run dev server and visually verify**

Run: `npm run dev`

Navigate to `/dashboards/idr-meeting`, select a project, and verify:
- Adders Checklist appears in the right column below Meeting Notes
- Pricing Breakdown appears below Adders Checklist
- AHJ & Utility Codes appears below Pricing Breakdown
- Roof checkboxes are mutually exclusive (checking one unchecks others)
- Custom adder add/remove works
- Pricing breakdown shows cost table, system metrics, and mismatch comparison
- Unmatched equipment warning appears if applicable

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/idr-meeting/ProjectDetail.tsx
git commit -m "feat(idr): integrate AddersChecklist and PricingBreakdown into ProjectDetail"
```

---

## Chunk 3: Testing

### Task 10: Test adder persistence pipelines

**Files:**
- Create: `src/__tests__/idr-adder-persistence.test.ts`

- [ ] **Step 1: Write tests for customAdders validation**

```typescript
import { describe, it, expect } from "@jest/globals";

/** Mirrors the validation logic from the PATCH handler */
function validateCustomAdders(input: unknown): string | null {
  if (!Array.isArray(input)) return "customAdders must be an array";
  if (input.length > 20) return "Maximum 20 custom adders";
  for (const adder of input) {
    if (!adder.name || typeof adder.name !== "string" || adder.name.length > 100) {
      return "Each custom adder must have a name (max 100 chars)";
    }
    if (typeof adder.amount !== "number" || !isFinite(adder.amount)) {
      return "Each custom adder must have a numeric amount";
    }
  }
  return null;
}

describe("customAdders validation", () => {
  it("accepts valid adders", () => {
    expect(validateCustomAdders([{ name: "Tree removal", amount: 800 }])).toBeNull();
  });

  it("accepts negative amounts (discounts)", () => {
    expect(validateCustomAdders([{ name: "Discount", amount: -500 }])).toBeNull();
  });

  it("rejects non-array", () => {
    expect(validateCustomAdders("not an array")).toBe("customAdders must be an array");
  });

  it("rejects more than 20 entries", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, amount: 100 }));
    expect(validateCustomAdders(many)).toBe("Maximum 20 custom adders");
  });

  it("rejects empty name", () => {
    expect(validateCustomAdders([{ name: "", amount: 100 }])).toBe(
      "Each custom adder must have a name (max 100 chars)"
    );
  });

  it("rejects name over 100 chars", () => {
    expect(validateCustomAdders([{ name: "x".repeat(101), amount: 100 }])).toBe(
      "Each custom adder must have a name (max 100 chars)"
    );
  });

  it("rejects non-numeric amount", () => {
    expect(validateCustomAdders([{ name: "test", amount: "abc" }])).toBe(
      "Each custom adder must have a numeric amount"
    );
  });

  it("rejects Infinity", () => {
    expect(validateCustomAdders([{ name: "test", amount: Infinity }])).toBe(
      "Each custom adder must have a numeric amount"
    );
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/idr-adder-persistence.test.ts --verbose`

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/idr-adder-persistence.test.ts
git commit -m "test(idr): add customAdders validation tests"
```

---

### Task 11: Test adder serialization and pricing calculation

**Files:**
- Create: `src/__tests__/idr-adder-serialization.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "@jest/globals";
import { serializeAdderSummary } from "@/lib/idr-meeting";
import { calcPrice, matchLineItemToEquipment, LOCATION_SCHEME } from "@/lib/pricing-calculator";
import { normalizeLocation } from "@/lib/locations";

describe("serializeAdderSummary", () => {
  const base = {
    adderTileRoof: false, adderMetalRoof: false, adderFlatFoamRoof: false,
    adderShakeRoof: false, adderSteepPitch: false, adderTwoStorey: false,
    adderTrenching: false, adderGroundMount: false, adderMpuUpgrade: false,
    adderEvCharger: false, customAdders: [],
  };

  it("returns null when no adders selected", () => {
    expect(serializeAdderSummary(base)).toBeNull();
  });

  it("serializes checkbox adders", () => {
    expect(serializeAdderSummary({ ...base, adderTileRoof: true, adderTrenching: true }))
      .toBe("Tile roof, Trenching");
  });

  it("includes custom adders with amounts", () => {
    expect(serializeAdderSummary({ ...base, customAdders: [{ name: "Tree removal", amount: 800 }] }))
      .toBe("Tree removal ($800)");
  });

  it("combines checkbox and custom adders", () => {
    const result = serializeAdderSummary({
      ...base,
      adderMpuUpgrade: true,
      customAdders: [{ name: "Discount", amount: -500 }],
    });
    expect(result).toBe("MPU/svc upgrade, Discount (-$500)");
  });
});

describe("pricing scheme resolution", () => {
  it("resolves canonical location to scheme", () => {
    const norm = normalizeLocation("Westminster");
    expect(norm).toBe("Westminster");
    expect(LOCATION_SCHEME[norm!]).toBe("base");
  });

  it("resolves alias to scheme", () => {
    const norm = normalizeLocation("westy");
    expect(norm).toBe("Westminster");
    expect(LOCATION_SCHEME[norm!]).toBe("base");
  });

  it("resolves SLO alias", () => {
    const norm = normalizeLocation("slo");
    expect(norm).toBe("San Luis Obispo");
    expect(LOCATION_SCHEME[norm!]).toBe("ventura");
  });

  it("returns null for unknown location", () => {
    expect(normalizeLocation("Mars")).toBeNull();
  });
});

describe("equipment matching", () => {
  it("matches Hyundai 440W module by name", () => {
    const code = matchLineItemToEquipment("Hyundai 440W Black", "", "module", "Hyundai");
    expect(code).toBe("HiN-T440NF(BK)");
  });

  it("matches Tesla Powerwall 3 by name", () => {
    const code = matchLineItemToEquipment("Tesla Powerwall 3", "", "battery", "Tesla");
    expect(code).toBe("Tesla Powerwall 3");
  });

  it("returns null for unrecognized equipment", () => {
    const code = matchLineItemToEquipment("Unknown Widget 9000", "", "other", "AcmeCorp");
    expect(code).toBeNull();
  });
});

describe("calcPrice with IDR-style inputs", () => {
  it("computes a basic solar system", () => {
    const result = calcPrice({
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      roofTypeId: "comp",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
      customFixedAdder: 0,
    });

    expect(result.totalWatts).toBe(8800);
    expect(result.cogs).toBeGreaterThan(0);
    expect(result.finalPrice).toBeGreaterThan(result.totalCosts);
    expect(result.markupPct).toBe(40);
  });

  it("tile roof adder increases price", () => {
    const base = {
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
      customFixedAdder: 0,
    };
    const noRoof = calcPrice({ ...base, roofTypeId: "comp" });
    const tileRoof = calcPrice({ ...base, roofTypeId: "tile" });
    expect(tileRoof.finalPrice).toBeGreaterThan(noRoof.finalPrice);
    expect(tileRoof.roofAdder).toBeGreaterThan(0);
  });

  it("custom adder adjusts final price", () => {
    const base = {
      modules: [{ code: "HiN-T440NF(BK)", qty: 20 }],
      inverters: [{ code: "IQ8MC-72-x-ACM-US", qty: 20 }],
      batteries: [],
      otherEquip: [],
      pricingSchemeId: "base",
      roofTypeId: "comp",
      storeyId: "1",
      pitchId: "none",
      activeAdderIds: [],
    };
    const noAdder = calcPrice({ ...base, customFixedAdder: 0 });
    const withDiscount = calcPrice({ ...base, customFixedAdder: -500 });
    expect(withDiscount.finalPrice).toBe(noAdder.finalPrice - 500);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/idr-adder-serialization.test.ts --verbose`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/idr-adder-serialization.test.ts
git commit -m "test(idr): add serialization, pricing scheme, and calcPrice integration tests"
```

---

### Task 12: Final type check and build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 2: Run full test suite**

Run: `npm run test`

Expected: All tests pass, including the new ones.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit any fixes if needed, then final commit**

```bash
git commit -m "chore(idr): verify type check and build pass for pricing/adders feature"
```

---

## Manual Testing Checklist

After implementation, manually verify these flows:

- [ ] **Prep-mode save + preview rehydrate:** Enter adder data in preview/prep mode, refresh page, verify adders persist
- [ ] **Skip/re-queue + session creation carryover:** Add adders to an escalation item, skip it, start a new session, verify adders carry over
- [ ] **Manual sync writes `idr_adders`:** Click "Sync to HubSpot" on an item with adders, verify the `idr_adders` property appears on the HubSpot deal and the timeline note includes adder text
- [ ] **Session-complete auto-sync writes `idr_adders`:** Complete a session with unsynced items that have adders, verify `idr_adders` is written for all items
- [ ] **Roof exclusivity:** Check "Tile roof", then check "Metal roof" — tile should uncheck. Only one active at a time
- [ ] **Unknown-location fallback warning:** If a deal has a non-standard `pb_location`, verify the yellow warning appears in the Pricing Breakdown
- [ ] **PE tag caveat note:** For deals with a "Participate" tag, verify the "PE/org-level adders not included" note appears below the delta
- [ ] **Unmatched equipment warning:** For deals with equipment not in the catalog, verify the yellow warning lists the unmatched items
