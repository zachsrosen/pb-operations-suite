# On-Call Call Log Improvements

**Date:** 2026-04-29
**Scope:** Three enhancements to the on-call emergency call log system

## Context

The on-call call log feature shipped in #459 and was relocated to the Ops suite in #460. Three gaps surfaced during initial use:

1. Only electricians matched to a `CrewMember` row see the "Log a call" button — admins cannot log calls on anyone's behalf from the dashboard.
2. When "Other" is selected as the issue type, there's no free-text field to describe what the issue actually was.
3. HR wants completed call logs automatically appended to a Google Sheet for record-keeping.

## Feature 1: Admin "Log a Call" Button

### Problem
The "Got a call?" CTA in `OnCallDashboardClient` is gated on `myCrew` (resolved via `/api/on-call/me` → `resolveElectricianByEmail`). The POST API already allows users with `canAdminOnCall` (ADMIN and EXECUTIVE roles), but the UI never shows the button for non-electricians.

**Note:** "admin" throughout this spec means `canAdminOnCall(user)` — which covers both `ADMIN` and `EXECUTIVE` roles. Do not check `user.roles.includes("ADMIN")` directly.

### Changes

**`/api/on-call/me` route** — refactor the early-return logic. Currently, if `resolveElectricianByEmail` returns null, the route returns immediately with `{ crewMember: null, shifts: [], pendingSwaps: [] }`. This must be restructured:

1. Compute `isAdmin = canAdminOnCall(user)` **before** the crew member check
2. If `!crew && !isAdmin` → return the short response (unchanged behavior for non-admin, non-electrician users)
3. If `!crew && isAdmin` → skip shifts/swaps/subscribeUrls (those require a crew member), return `{ crewMember: null, isAdmin: true, activeCrewMembers: [...], shifts: [], pendingSwaps: [] }`
4. If `crew` exists → existing logic plus `isAdmin` field

New response shape:
```ts
{
  crewMember: { id, name, email } | null,  // existing
  isAdmin: boolean,                         // NEW — canAdminOnCall(user)
  activeCrewMembers: { id, name }[],        // NEW — only when isAdmin=true
  // ... existing shifts, pendingSwaps, etc.
}
```
`activeCrewMembers` is fetched from `prisma.crewMember.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })` only when the caller is an admin.

**`OnCallDashboardClient`** — two changes:

1. Show the CTA strip when `myCrew != null` **OR** `me.data?.isAdmin`:
```tsx
const showCallLog = myCrew || me.data?.isAdmin;
```

2. Expand the `<CallLogModal>` mount condition from `{myCrew && ...}` to `{showCallLog && ...}`. When admin, pass `crewMember={null}` and `activeCrewMembers={me.data?.activeCrewMembers ?? []}`.

**`CallLogModal`** — accept nullable `crewMember` prop:
```ts
type Props = {
  open: boolean;
  onClose: () => void;
  crewMember: { id: string; name: string } | null;  // null = admin path
  activeCrewMembers?: { id: string; name: string }[];
  defaultPoolId?: string;
};
```
When `crewMember` is null, render a **"Who took the call?"** select dropdown at the top of the form populated from `activeCrewMembers`. The `canSubmit` condition must include crew member selection:
```ts
const reporterId = crewMember?.id ?? pickedCrewMemberId;
const canSubmit =
  Boolean(reporterId) &&  // NEW — blocks submit until crew is picked (admin path)
  Boolean(poolId) &&
  // ... existing conditions
```
`reporterCrewMemberId` in the payload comes from the picker (admin) or the pre-filled prop (electrician).

### Files to modify
- `src/app/api/on-call/me/route.ts` — refactor early-return, add `isAdmin` + `activeCrewMembers`
- `src/components/on-call/OnCallDashboardClient.tsx` — expand CTA + modal mount conditions, pass new props
- `src/components/on-call/CallLogModal.tsx` — accept nullable crewMember, add crew picker, update canSubmit

## Feature 2: "Other" Issue Type Write-In

### Problem
The issue type dropdown includes "Other" but there's no way to describe what "other" means. The value is stored as `"other"` with no context.

### Changes

**Prisma migration** — add nullable column:
```prisma
model OnCallCallLog {
  // ... existing fields
  issueTypeOther  String?   // free-text when issueType="other"
}
```

**`CallLogModal`** — when `issueType === "other"`, render a required text input below the dropdown:
```
Label: "Describe the issue"
Placeholder: "e.g., Panel critter guard, Tree fell on array"
Required when issueType is "other"
```
Value sent as `issueTypeOther` in the payload.

**`/api/on-call/call-logs` POST** — accept and validate:
- Add `issueTypeOther` to the accepted body fields
- If `issueType === "other"` and `issueTypeOther` is empty/missing → 400
- Save to the new column

**`on-call-call-log.ts`** — add `issueTypeOther?: string | null` to `CallLogPayload`.

**`CallLogList`** — when displaying a log with `issueType === "other"`, show the custom text:
```
Other — Panel critter guard
```

### Files to modify
- `prisma/schema.prisma` — add `issueTypeOther` column
- New migration file
- `src/lib/on-call-call-log.ts` — add field to `CallLogPayload`
- `src/components/on-call/CallLogModal.tsx` — conditional text input
- `src/app/api/on-call/call-logs/route.ts` — accept + validate + save
- `src/components/on-call/CallLogList.tsx` — display custom text

## Feature 3: Google Sheet Append for HR

### Problem
HR wants a running record of all emergency call logs in a Google Sheet they can filter, sort, and export.

### Design

**Env var:** `ONCALL_HR_SHEET_ID=1OhWI89-UE7PGBjNLzut2ccL5m9S506QyFy-gOQZLu0k`

**Auth:** Existing service account from `src/lib/google-auth.ts` with domain-wide delegation. The service account email must be shared as Editor on the sheet (one-time manual step). Add `https://www.googleapis.com/auth/spreadsheets` scope when creating the auth client.

**New file: `src/lib/on-call-sheet.ts`**

Exports `appendCallLogToSheet(log)`:
1. Build a Google Sheets API client using the service account JWT
2. Read row 1 to check if headers exist
3. If empty, write the header row first
4. Append a data row with values mapped from the call log record

**Sheet columns (header row):**
| Date | Time | Pool | Region | Electrician | Customer | Issue Type | Issue Detail | Safety Risk | Home Has Power | Troubleshooting | Resolved Remotely | Dispatched | Arrival | Completion | Hours Worked | Escalated To | Notes |

**Column mapping:**
- Date: `callReceivedAt` formatted as `MM/DD/YYYY`
- Time: `callReceivedAt` formatted as `HH:MM AM/PM` in pool timezone
- Pool: `pool.name`
- Region: `pool.region`
- Electrician: `reporterCrewMember.name`
- Customer: `customerName`
- Issue Type: `issueType` label (lookup from ISSUE_TYPES)
- Issue Detail: `issueTypeOther` or empty
- Safety Risk: `safetyRisk` → "Yes" / "No"
- Home Has Power: `homeHasPower` → "Yes" / "No" / "Didn't ask"
- Troubleshooting: `troubleshootingAttempted`
- Resolved Remotely: `resolvedRemotely` → "Yes" / "No"
- Dispatched: `dispatched` → "Yes" / "No"
- Arrival: `arrivalAt` formatted as time or empty
- Completion: `completedAt` formatted as time or empty
- Hours Worked: `hoursWorked` or empty
- Escalated To: `escalatedTo` or empty
- Notes: `notes` or empty

**Integration point:** After the DB insert in `POST /api/on-call/call-logs`, use `waitUntil()` from `@vercel/functions` (already in `package.json`) to register the sheet append as background work that survives the response boundary. On Vercel serverless, unawaited promises are killed when the function exits — `waitUntil` prevents this.

```ts
import { waitUntil } from "@vercel/functions";

// After DB insert, before return:
if (process.env.ONCALL_HR_SHEET_ID) {
  waitUntil(
    appendCallLogToSheet(log).catch((e) => {
      console.error("[on-call-sheet] append failed:", e);
      // Sentry captureException if available
    })
  );
}
return NextResponse.json({ log });
```

If `ONCALL_HR_SHEET_ID` is unset, the append is skipped entirely.

**Failure behavior:** Silent. The DB row is the source of truth. If the sheet append fails (Drive outage, bad token, revoked access), the 200 response is already sent. The error is logged server-side only.

**Auth pattern:** Use the existing `getServiceAccountToken()` from `src/lib/google-auth.ts` with `["https://www.googleapis.com/auth/spreadsheets"]` scope, then raw `fetch` calls to the Sheets REST API (`https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}:append`). This is consistent with how `drive-plansets.ts` calls the Drive API — no `googleapis` SDK dependency needed.

### Files to create/modify
- `src/lib/on-call-sheet.ts` — NEW, sheet append helper (raw fetch + service account token)
- `src/app/api/on-call/call-logs/route.ts` — call `appendCallLogToSheet` via `waitUntil`
- `.env.example` — document `ONCALL_HR_SHEET_ID`

### Dependencies
- None — uses existing `@vercel/functions` and `google-auth.ts` service account flow

## Verification

1. **Admin button:**
   - Log in as admin → navigate to `/dashboards/on-call` → see "Got a call?" CTA
   - Click "Log a call" → see crew member picker at top of modal
   - Select an electrician, fill fields, submit → call log saved with correct reporter
   - Log in as electrician → button still works without picker (pre-filled identity)

2. **"Other" write-in:**
   - Open call log modal → select "Other" issue type → text input appears
   - Submit without filling it → validation error
   - Fill it → submit → `issueTypeOther` saved in DB
   - Call log list shows "Other — <custom text>"

3. **Google Sheet:**
   - Share sheet with service account email as Editor
   - Set `ONCALL_HR_SHEET_ID` in env
   - Submit a call log → new row appears in the sheet within seconds
   - First row should have headers if sheet was empty
   - Kill `ONCALL_HR_SHEET_ID` → submit still succeeds (silent fallback)

4. **Build:**
   - `npm run build` passes with no TypeScript errors
   - Prisma migration applies cleanly
