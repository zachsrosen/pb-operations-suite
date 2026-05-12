# IDR Design Revision Workflow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Design Revision Needed?" toggle to the IDR Meeting Hub that writes `design_status` on sync, and auto-complete the Initial Design Review for items that pass without revision.

**Two features, independent but complementary:**
- **Feature A:** "Design Revision Needed?" toggle → sync sets `design_status = "IDR Revision Needed"`
- **Feature B:** Auto-advance on sync → if item is Reviewed and NOT flagged for revision, set `design_status = "Draft Complete - Waiting on Approvals"`

**Architecture:** New boolean + text fields on `IdrMeetingItem` and `IdrEscalationQueue` (prep carry-over). UI toggle in `StatusActionsForm`. Sync logic in `buildHubSpotPropertyUpdates` + `buildHubSpotNoteBody`. No new API routes, no new models.

**HubSpot prerequisite:** The value `"IDR Revision Needed"` must exist as an option on the `design_status` property in HubSpot before this ships. (User is creating it.)

---

## Chunk 1: Prisma Schema Migration

### Task 1: Add new fields to IdrMeetingItem and IdrEscalationQueue

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to `IdrMeetingItem`**

After the `shitShowReason` field (line ~2555), add:

```prisma
  // Design Revision flag — sets design_status on sync
  designRevisionNeeded Boolean @default(false)
  designRevisionReason String?
```

- [ ] **Step 2: Add matching fields to `IdrEscalationQueue`**

After the `conclusion` field (line ~2635), add:

```prisma
  designRevisionNeeded Boolean @default(false)
  designRevisionReason String?
```

- [ ] **Step 3: Generate and apply migration**

```bash
npx prisma migrate dev --name add-idr-design-revision-fields
```

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(idr-meeting): add designRevisionNeeded + designRevisionReason schema fields"
```

---

## Chunk 2: Backend — Sync Logic + Field Allowlists

### Task 2: Wire new fields into sync, notes, and property updates

**Files:**
- Modify: `src/lib/idr-meeting.ts`
- Modify: `src/app/api/idr-meeting/items/[id]/route.ts` (EDITABLE_FIELDS)
- Modify: `src/app/api/idr-meeting/prep/route.ts` (PREP_FIELDS)
- Modify: `src/app/api/idr-meeting/sessions/route.ts` (pickPrepFields)

- [ ] **Step 1: Add `design_status` logic to `buildHubSpotPropertyUpdates`**

In `src/lib/idr-meeting.ts`, the `PropertyFields` interface (line ~360) needs two new fields:

```ts
  designRevisionNeeded: boolean;
  reviewed: boolean;
```

In `buildHubSpotPropertyUpdates` (line ~378), add **after** the adder lines (independent of `layout_status` logic):

```ts
  // Design status — revision flag vs auto-advance (independent of layout_status)
  if (fields.designRevisionNeeded) {
    updates.design_status = "IDR Revision Needed";
  } else if (fields.reviewed) {
    updates.design_status = "Draft Complete - Waiting on Approvals";
  }
```

- [ ] **Step 2: Add revision to `buildHubSpotNoteBody`**

In the `NoteFields` interface add:

```ts
  designRevisionNeeded?: boolean;
  designRevisionReason?: string | null;
```

In the note body builder, add a line (near the shitShowFlagged line):

```ts
  if (fields.designRevisionNeeded) {
    lines.push(`<strong>⚠️ Design Revision Needed</strong>${fields.designRevisionReason ? `: ${esc(fields.designRevisionReason)}` : ""}`);
  }
```

- [ ] **Step 3: Pass new fields through `syncItemToHubSpot`**

Add `designRevisionNeeded` and `designRevisionReason` to:
1. The item type parameter (line ~689)
2. The `buildHubSpotPropertyUpdates` call (line ~733) — pass `designRevisionNeeded` and `reviewed` (item.reviewed)
3. The `buildHubSpotNoteBody` call (line ~757)

- [ ] **Step 4: Add to EDITABLE_FIELDS in items PATCH route**

In `src/app/api/idr-meeting/items/[id]/route.ts`, add to `EDITABLE_FIELDS` array:

```ts
  "designRevisionNeeded", "designRevisionReason",
```

- [ ] **Step 5: Add to PREP_FIELDS in prep route**

In `src/app/api/idr-meeting/prep/route.ts`, add to `PREP_FIELDS` array:

```ts
  "designRevisionNeeded", "designRevisionReason",
```

- [ ] **Step 6: Add to pickPrepFields in session creation**

In `src/app/api/idr-meeting/sessions/route.ts`, inside `pickPrepFields` (line ~156), add:

```ts
  ...(q.designRevisionNeeded ? { designRevisionNeeded: q.designRevisionNeeded } : {}),
  ...(q.designRevisionReason ? { designRevisionReason: q.designRevisionReason } : {}),
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/idr-meeting.ts src/app/api/idr-meeting/
git commit -m "feat(idr-meeting): wire design_status sync — revision flag + auto-advance"
```

---

## Chunk 3: Frontend — Toggle UI

### Task 3: Add "Design Revision Needed?" toggle to StatusActionsForm

**Files:**
- Modify: `src/app/dashboards/idr-meeting/StatusActionsForm.tsx`
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` (type)
- Modify: `src/app/dashboards/idr-meeting/DealHistoryDetail.tsx` (type + display)

- [ ] **Step 1: Add fields to IdrItem type**

In `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx`, add to the `IdrItem` interface:

```ts
  designRevisionNeeded: boolean;
  designRevisionReason: string | null;
```

- [ ] **Step 2: Update StatusActionsForm**

Rename the section title in `ProjectDetail.tsx` from `"DA Status Actions"` to `"Status Actions"` (since it now includes design_status, not just layout_status).

In `StatusActionsForm.tsx`, add a third toggle block **above** the divider (before the Shit Show toggle), following the same pattern as Sales Change:

```tsx
{/* Design Revision Needed */}
<div>
  <div className="flex items-center gap-2">
    <ToggleSwitch
      checked={!!item.designRevisionNeeded}
      onChange={() => handleToggle("designRevisionNeeded")}
      disabled={readOnly}
    />
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
      Design Revision Needed
    </span>
  </div>
  {item.designRevisionNeeded && (
    <CompactTextarea
      value={item.designRevisionReason ?? ""}
      onChange={(val) => handleText("designRevisionReason", val)}
      readOnly={readOnly}
      placeholder="Revision reason (required)..."
    />
  )}
</div>
```

Update the `activeStatus` logic at the top of the component to include the design revision indicator. Since this writes to `design_status` (independent of `layout_status`), add a **second** status indicator:

```tsx
const designAction = item.designRevisionNeeded
  ? "IDR Revision Needed"
  : null;
```

Add a second indicator pill below the existing one:

```tsx
{designAction && (
  <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500">
      On sync → design status: {designAction}
    </p>
  </div>
)}
```

- [ ] **Step 3: Add to textFields set in IdrMeetingClient**

In `IdrMeetingClient.tsx`, add `"designRevisionReason"` to the `textFields` set in `handleItemChange` (line ~443):

```ts
const textFields = new Set([
  "customerNotes", "operationsNotes", "designNotes", "conclusion",
  "salesChangeNotes", "opsChangeNotes", "shitShowReason", "escalationReason",
  "designRevisionReason",
]);
```

- [ ] **Step 4: Update DealHistoryDetail**

In `DealHistoryDetail.tsx`, add the fields to the item type and display the revision flag in the history view when present:

```tsx
{item.designRevisionNeeded && (
  <NoteField
    label="Design Revision Needed"
    value={item.designRevisionReason || "Yes"}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/idr-meeting/
git commit -m "feat(idr-meeting): Design Revision Needed toggle + auto-advance indicator UI"
```

---

## Chunk 4: Verification + Cleanup

### Task 4: Type-check, test, and verify

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit
```

Fix any type errors across the codebase caused by the new fields.

- [ ] **Step 2: Start dev server and verify**

Open `/dashboards/idr-meeting` in browser. Verify:
1. New "Design Revision Needed" toggle appears in Status Actions section
2. Toggling it shows the reason textarea
3. Red indicator pill shows "On sync → design status: IDR Revision Needed"
4. Toggling it off removes the indicator
5. Existing "Sales Change" and "Needs Survey Info" toggles still work independently
6. The orange `layout_status` indicator still shows for Sales Change / Needs Survey Info
7. Both indicators can appear simultaneously (one orange for layout_status, one red for design_status)

- [ ] **Step 3: Test sync behavior** (requires active session)

1. Create a test session, select an item
2. Toggle "Design Revision Needed" with a reason, click Sync → verify `design_status` is set to `"IDR Revision Needed"` in HubSpot
3. On another item: mark Reviewed, do NOT toggle revision, click Sync → verify `design_status` is set to `"Draft Complete - Waiting on Approvals"`
4. Verify timeline note includes revision information when flagged

- [ ] **Step 4: Verify prep carry-over**

1. In preview mode, toggle "Design Revision Needed" on a deal with a reason
2. Start a new session → verify the flag and reason carry over to the session item

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(idr-meeting): IDR Design Revision workflow — complete"
```

---

## Summary of all touched files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `designRevisionNeeded` + `designRevisionReason` to `IdrMeetingItem` and `IdrEscalationQueue` |
| `src/lib/idr-meeting.ts` | `buildHubSpotPropertyUpdates`: add `design_status` logic. `buildHubSpotNoteBody`: add revision line. `syncItemToHubSpot`: pass new fields |
| `src/app/api/idr-meeting/items/[id]/route.ts` | Add to `EDITABLE_FIELDS` |
| `src/app/api/idr-meeting/prep/route.ts` | Add to `PREP_FIELDS` |
| `src/app/api/idr-meeting/sessions/route.ts` | Add to `pickPrepFields` |
| `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` | Add to `IdrItem` type + `textFields` set |
| `src/app/dashboards/idr-meeting/StatusActionsForm.tsx` | Add toggle + reason textarea + design status indicator |
| `src/app/dashboards/idr-meeting/ProjectDetail.tsx` | Rename section title to "Status Actions" |
| `src/app/dashboards/idr-meeting/DealHistoryDetail.tsx` | Add type fields + revision display in history |
