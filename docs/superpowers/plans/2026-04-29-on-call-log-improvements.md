# On-Call Call Log Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin call-logging, "Other" issue write-in, and Google Sheets HR export to the on-call emergency call log.

**Architecture:** Three independent features touching the same POST endpoint and modal form. The Prisma migration (Feature 2) ships first so the column exists for both the API and Sheet export. Features 1 and 3 are independent of each other.

**Tech Stack:** Next.js 16, React 19, Prisma 7, Google Sheets REST API via raw fetch + service account JWT, `@vercel/functions` waitUntil.

**Spec:** `docs/superpowers/specs/2026-04-29-on-call-log-improvements.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma:3170` | Add `issueTypeOther` column |
| Create | `prisma/migrations/<timestamp>_add_issue_type_other/migration.sql` | Migration |
| Modify | `src/lib/on-call-call-log.ts` | Add `issueTypeOther` to `CallLogPayload` |
| Create | `src/lib/on-call-sheet.ts` | Google Sheets append helper |
| Modify | `src/app/api/on-call/me/route.ts` | Add `isAdmin` + `activeCrewMembers`, refactor early-return |
| Modify | `src/app/api/on-call/call-logs/route.ts` | Validate `issueTypeOther`, save it, call sheet append via `waitUntil` |
| Modify | `src/components/on-call/CallLogModal.tsx` | Nullable crewMember, crew picker, issueTypeOther field, updated canSubmit |
| Modify | `src/components/on-call/OnCallDashboardClient.tsx` | Expand CTA + modal mount to include admins |
| Modify | `src/components/on-call/CallLogList.tsx` | Display `issueTypeOther` text next to "Other" |
| Modify | `.env.example` | Document `ONCALL_HR_SHEET_ID` |

---

## Chunk 1: Prisma Migration + Shared Types

### Task 1: Add `issueTypeOther` column to schema

**Files:**
- Modify: `prisma/schema.prisma:3170`

- [ ] **Step 1: Add the column after `issueType`**

In `prisma/schema.prisma`, find the `OnCallCallLog` model and add after the `issueType` line (line 3170):

```prisma
  issueType                String
  issueTypeOther           String?   /// Free-text description when issueType="other"
  safetyRisk               Boolean  @default(false)
```

- [ ] **Step 2: Create the migration**

```bash
npx prisma migrate dev --name add_issue_type_other --create-only
```

Expected: a new migration file in `prisma/migrations/`.

- [ ] **Step 3: Verify the SQL**

The migration SQL should be a single `ALTER TABLE "OnCallCallLog" ADD COLUMN "issueTypeOther" TEXT;`

- [ ] **Step 4: Apply the migration**

```bash
npx prisma migrate deploy
```

- [ ] **Step 5: Regenerate client**

```bash
npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore(on-call): add issueTypeOther column to OnCallCallLog"
```

### Task 2: Update `CallLogPayload` type

**Files:**
- Modify: `src/lib/on-call-call-log.ts:34-50`

- [ ] **Step 1: Add `issueTypeOther` to `CallLogPayload`**

In `src/lib/on-call-call-log.ts`, add the field after `issueType`:

```ts
export type CallLogPayload = {
  poolId: string;
  reporterCrewMemberId: string;
  callReceivedAt: string; // ISO
  customerName: string;
  issueType: string;
  issueTypeOther?: string | null;  // NEW — free-text when issueType="other"
  safetyRisk?: boolean;
  // ... rest unchanged
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/on-call-call-log.ts
git commit -m "feat(on-call): add issueTypeOther to CallLogPayload type"
```

---

## Chunk 2: API Changes

### Task 3: Refactor `/api/on-call/me` for admin support

**Files:**
- Modify: `src/app/api/on-call/me/route.ts`

- [ ] **Step 1: Add import for `canAdminOnCall`**

Add to the imports at top of file:

```ts
import { canAdminOnCall } from "@/lib/on-call-auth";
```

- [ ] **Step 2: Refactor the GET handler early-return logic**

Replace lines 27-34 (the user/crew checks) with:

```ts
  const user = await getCurrentUser();
  if (!user?.email) {
    return NextResponse.json({ crewMember: null, isAdmin: false, shifts: [], pendingSwaps: [] });
  }

  const isAdmin = canAdminOnCall(user);
  const crew = await resolveElectricianByEmail(user.email);

  // Non-electrician, non-admin: short response
  if (!crew && !isAdmin) {
    return NextResponse.json({ crewMember: null, isAdmin: false, shifts: [], pendingSwaps: [] });
  }
```

- [ ] **Step 3: Add activeCrewMembers fetch for admins**

After the early-return block, before the `today` line, add:

```ts
  // Admin-only: list all active crew members for the "who took the call?" picker
  const activeCrewMembers = isAdmin
    ? await prisma.crewMember.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
```

- [ ] **Step 4: Guard crew-dependent queries**

Wrap the shifts, pendingSwaps, myRequests, and subscribeUrls blocks so they only run when `crew` is non-null. The simplest way: introduce variables with empty defaults and populate conditionally.

Replace everything from line 36 (`const today = ...`) through line 128 (end of `subscribeUrls`) with:

```ts
  let shifts: Shift[] = [];
  let pendingSwaps: unknown[] = [];
  let myRequests: unknown[] = [];
  let subscribeUrls: unknown[] = [];

  if (crew) {
    const today = todayInTz("America/Denver");

    // (existing shifts, pendingSwaps, myRequests, subscribeUrls code — unchanged)
    // ... move the entire block here, indented one level
  }
```

Keep the `type Shift = { ... }` declaration above this block (outside the `if`).

- [ ] **Step 5: Add `isAdmin` and `activeCrewMembers` to response**

Update the final return to:

```ts
  return NextResponse.json({
    crewMember: crew ? { id: crew.id, name: crew.name, email: crew.email } : null,
    isAdmin,
    activeCrewMembers,
    shifts,
    pendingSwaps,
    myRequests,
    subscribeUrls,
  });
```

- [ ] **Step 6: Verify no TS errors**

```bash
npx tsc --noEmit --pretty 2>&1 | grep "on-call/me"
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/on-call/me/route.ts
git commit -m "feat(on-call): add isAdmin + activeCrewMembers to /api/on-call/me"
```

### Task 4: Update POST `/api/on-call/call-logs` — issueTypeOther validation + save

**Files:**
- Modify: `src/app/api/on-call/call-logs/route.ts`

- [ ] **Step 1: Add issueTypeOther validation**

After the `ISSUE_TYPE_VALUES` check (around line 86-88), add:

```ts
  if (body.issueType === "other" && (!body.issueTypeOther || !body.issueTypeOther.trim())) {
    return NextResponse.json({ error: "issueTypeOther is required when issueType is 'other'" }, { status: 400 });
  }
```

- [ ] **Step 2: Add issueTypeOther to the `prisma.onCallCallLog.create` data**

In the `data` block of `prisma.onCallCallLog.create` (around line 108), add after `issueType`:

```ts
      issueType: body.issueType,
      issueTypeOther: body.issueType === "other" ? (body.issueTypeOther?.trim() ?? null) : null,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/on-call/call-logs/route.ts
git commit -m "feat(on-call): validate + save issueTypeOther in call-logs POST"
```

### Task 5: Google Sheets append helper

**Files:**
- Create: `src/lib/on-call-sheet.ts`

- [ ] **Step 1: Create the sheet helper**

Create `src/lib/on-call-sheet.ts`:

```ts
/**
 * Append a call log row to the HR Google Sheet.
 * Fire-and-forget — caller wraps in waitUntil() + catch.
 *
 * Auth: service account JWT via google-auth.ts (no googleapis SDK).
 * Pattern: matches drive-plansets.ts raw-fetch approach.
 */
import { getServiceAccountToken } from "@/lib/google-auth";
import { ISSUE_TYPES } from "@/lib/on-call-call-log";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ISSUE_LABEL = new Map(ISSUE_TYPES.map((t) => [t.value, t.label]));

const HEADERS = [
  "Date",
  "Time",
  "Pool",
  "Region",
  "Electrician",
  "Customer",
  "Issue Type",
  "Issue Detail",
  "Safety Risk",
  "Home Has Power",
  "Troubleshooting",
  "Resolved Remotely",
  "Dispatched",
  "Arrival",
  "Completion",
  "Hours Worked",
  "Escalated To",
  "Notes",
];

type CallLogRecord = {
  callReceivedAt: Date;
  customerName: string;
  issueType: string;
  issueTypeOther: string | null;
  safetyRisk: boolean;
  homeHasPower: boolean | null;
  troubleshootingAttempted: string | null;
  resolvedRemotely: boolean;
  dispatched: boolean;
  arrivalAt: Date | null;
  completedAt: Date | null;
  hoursWorked: unknown; // Prisma Decimal
  escalatedTo: string | null;
  notes: string | null;
  reporterCrewMember: { name: string };
  pool: { name: string; region: string };
};

async function getToken(): Promise<string> {
  // Try domain-wide delegation first (impersonating admin), fall back to plain SA
  const adminEmail = process.env.GOOGLE_ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL;
  try {
    return await getServiceAccountToken([SHEETS_SCOPE], adminEmail || undefined);
  } catch {
    return await getServiceAccountToken([SHEETS_SCOPE]);
  }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/Denver" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/Denver",
    hour: "numeric",
    minute: "2-digit",
  });
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function buildRow(log: CallLogRecord): string[] {
  return [
    fmtDate(log.callReceivedAt),
    fmtTime(log.callReceivedAt),
    log.pool.name,
    log.pool.region,
    log.reporterCrewMember.name,
    log.customerName,
    ISSUE_LABEL.get(log.issueType) ?? log.issueType,
    log.issueTypeOther ?? "",
    yesNo(log.safetyRisk),
    log.homeHasPower === true ? "Yes" : log.homeHasPower === false ? "No" : "Didn't ask",
    log.troubleshootingAttempted ?? "",
    yesNo(log.resolvedRemotely),
    yesNo(log.dispatched),
    log.arrivalAt ? fmtTime(log.arrivalAt) : "",
    log.completedAt ? fmtTime(log.completedAt) : "",
    log.hoursWorked != null ? String(Number(log.hoursWorked)) : "",
    log.escalatedTo ?? "",
    log.notes ?? "",
  ];
}

export async function appendCallLogToSheet(log: CallLogRecord): Promise<void> {
  const sheetId = process.env.ONCALL_HR_SHEET_ID;
  if (!sheetId) return; // env var not set — silently skip

  const token = await getToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

  // Check if header row exists (read A1)
  const checkRes = await fetch(`${base}/values/Sheet1!A1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const checkData = (await checkRes.json()) as { values?: string[][] };
  const hasHeaders = checkData.values && checkData.values.length > 0 && checkData.values[0].length > 0;

  // If no headers yet, write them first
  if (!hasHeaders) {
    await fetch(`${base}/values/Sheet1!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [HEADERS] }),
    });
  }

  // Append the data row
  const row = buildRow(log);
  const appendRes = await fetch(
    `${base}/values/Sheet1!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    },
  );

  if (!appendRes.ok) {
    const errBody = await appendRes.text();
    throw new Error(`Sheets API ${appendRes.status}: ${errBody}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/on-call-sheet.ts
git commit -m "feat(on-call): Google Sheets append helper for HR call logs"
```

### Task 6: Wire sheet append into call-logs POST via waitUntil

**Files:**
- Modify: `src/app/api/on-call/call-logs/route.ts`

- [ ] **Step 1: Add imports**

Add at top of file:

```ts
import { waitUntil } from "@vercel/functions";
import { appendCallLogToSheet } from "@/lib/on-call-sheet";
```

- [ ] **Step 2: Add waitUntil call after DB insert**

After the `logActivity` call (around line 132-139), before the final `return`, add:

```ts
  // Append to HR Google Sheet in the background — silent on failure
  if (process.env.ONCALL_HR_SHEET_ID) {
    waitUntil(
      appendCallLogToSheet(log).catch((e) => {
        console.error("[on-call-sheet] append failed:", e);
      }),
    );
  }
```

- [ ] **Step 3: Verify the `log` variable includes the needed relations**

Check that the `prisma.onCallCallLog.create` call's `include` block already has `reporterCrewMember` and `pool`. It does (lines 127-129), but verify `pool` includes `region`:

Update the pool include from:
```ts
      pool: { select: { id: true, name: true, region: true } },
```

Check if `region` is already there. If not, add it. (The spec requires `pool.region` for the sheet.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/on-call/call-logs/route.ts
git commit -m "feat(on-call): wire Google Sheets append via waitUntil in call-logs POST"
```

### Task 7: Document env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add `ONCALL_HR_SHEET_ID`**

Add near other on-call env vars:

```
# On-Call HR Sheet — Google Sheet ID for appending call logs
ONCALL_HR_SHEET_ID=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add ONCALL_HR_SHEET_ID to .env.example"
```

---

## Chunk 3: UI Changes

### Task 8: Update `OnCallDashboardClient` for admin visibility

**Files:**
- Modify: `src/components/on-call/OnCallDashboardClient.tsx`

- [ ] **Step 1: Update the `MeResp` type**

Add the new fields to the `MeResp` type at line 27:

```ts
type MeResp = {
  crewMember: { id: string; name: string; email: string | null } | null;
  isAdmin?: boolean;
  activeCrewMembers?: { id: string; name: string }[];
};
```

- [ ] **Step 2: Derive showCallLog and admin props**

After `const myCrew = me.data?.crewMember ?? null;` and the `defaultPoolId` line, add:

```ts
  const isAdmin = me.data?.isAdmin ?? false;
  const showCallLog = Boolean(myCrew) || isAdmin;
```

- [ ] **Step 3: Replace CTA visibility condition**

Change `{myCrew && (` (the CTA section, around line 82) to `{showCallLog && (`.

- [ ] **Step 4: Replace modal mount condition**

Change `{myCrew && (` (the CallLogModal section, around line 120) to `{showCallLog && (`.

- [ ] **Step 5: Update modal props for admin path**

Update the `<CallLogModal>` render to pass nullable crewMember and crew list:

```tsx
      {showCallLog && (
        <CallLogModal
          open={callLogOpen}
          onClose={() => setCallLogOpen(false)}
          crewMember={myCrew ? { id: myCrew.id, name: myCrew.name } : null}
          activeCrewMembers={me.data?.activeCrewMembers}
          defaultPoolId={defaultPoolId}
        />
      )}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/on-call/OnCallDashboardClient.tsx
git commit -m "feat(on-call): show call log CTA + modal for admins"
```

### Task 9: Update `CallLogModal` — crew picker, issueTypeOther field, canSubmit

**Files:**
- Modify: `src/components/on-call/CallLogModal.tsx`

- [ ] **Step 1: Update `CallLogModal` component signature**

Change the props type and destructuring (lines 20-30) to accept nullable `crewMember` and optional `activeCrewMembers`:

```tsx
export function CallLogModal({
  open,
  onClose,
  crewMember,
  activeCrewMembers,
  defaultPoolId,
}: {
  open: boolean;
  onClose: () => void;
  crewMember: CrewMemberRef | null;
  activeCrewMembers?: CrewMemberRef[];
  defaultPoolId?: string;
}) {
```

- [ ] **Step 2: Pass new props through to `CallLogForm`**

Update the `<CallLogForm>` render inside the modal shell (line 51):

```tsx
        <CallLogForm
          crewMember={crewMember}
          activeCrewMembers={activeCrewMembers}
          defaultPoolId={defaultPoolId}
          onClose={onClose}
        />
```

- [ ] **Step 3: Update `CallLogForm` signature**

Update `CallLogForm` props (lines 61-69):

```tsx
function CallLogForm({
  crewMember,
  activeCrewMembers,
  defaultPoolId,
  onClose,
}: {
  crewMember: CrewMemberRef | null;
  activeCrewMembers?: CrewMemberRef[];
  defaultPoolId?: string;
  onClose: () => void;
}) {
```

- [ ] **Step 4: Add crew picker state and issueTypeOther state**

After `const [notes, setNotes] = useState("");` (line 109), add:

```ts
  const [pickedCrewMemberId, setPickedCrewMemberId] = useState("");
  const [issueTypeOther, setIssueTypeOther] = useState("");
```

- [ ] **Step 5: Derive reporterId**

After the state declarations, add:

```ts
  const reporterId = crewMember?.id ?? pickedCrewMemberId;
```

- [ ] **Step 6: Update canSubmit**

Replace the `canSubmit` block (lines 159-165) with:

```ts
  const canSubmit =
    Boolean(reporterId) &&
    Boolean(poolId) &&
    callReceivedAt.length > 0 &&
    customerName.trim().length > 0 &&
    issueType.length > 0 &&
    (issueType !== "other" || issueTypeOther.trim().length > 0) &&
    resolvedRemotely !== null &&
    !submit.isPending;
```

- [ ] **Step 7: Update mutation body**

In the `submit` mutation's `mutationFn` (lines 124-151), update `reporterCrewMemberId` and add `issueTypeOther`:

```ts
        reporterCrewMemberId: reporterId,
```

And add after `issueType,`:

```ts
        issueTypeOther: issueType === "other" ? issueTypeOther.trim() : null,
```

- [ ] **Step 8: Add crew picker JSX**

After the `submitErr` div (line 179), before the pool selector, add:

```tsx
      {/* Admin: pick the reporting electrician */}
      {!crewMember && activeCrewMembers && activeCrewMembers.length > 0 && (
        <Field label="Who took the call?">
          <select
            value={pickedCrewMemberId}
            onChange={(e) => setPickedCrewMemberId(e.target.value)}
            className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            required
          >
            <option value="">— Select electrician —</option>
            {activeCrewMembers.map((cm) => (
              <option key={cm.id} value={cm.id}>
                {cm.name}
              </option>
            ))}
          </select>
        </Field>
      )}
```

- [ ] **Step 9: Add issueTypeOther input after issue type dropdown**

After the `</Field>` closing the issue type dropdown (line 233), add:

```tsx
      {issueType === "other" && (
        <Field label="Describe the issue">
          <input
            type="text"
            value={issueTypeOther}
            onChange={(e) => setIssueTypeOther(e.target.value)}
            placeholder="e.g., Panel critter guard, Tree fell on array"
            className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            required
          />
        </Field>
      )}
```

- [ ] **Step 10: Commit**

```bash
git add src/components/on-call/CallLogModal.tsx
git commit -m "feat(on-call): admin crew picker + issueTypeOther field in CallLogModal"
```

### Task 10: Update `CallLogList` to show issueTypeOther

**Files:**
- Modify: `src/components/on-call/CallLogList.tsx`

- [ ] **Step 1: Add `issueTypeOther` to the `CallLog` type**

Add after `issueType: string;` (line 12):

```ts
  issueTypeOther: string | null;
```

- [ ] **Step 2: Update the display**

Change the issue type label render (line 75) from:

```tsx
                <span className="text-xs text-muted">
                  {ISSUE_LABEL.get(log.issueType) ?? log.issueType}
                </span>
```

to:

```tsx
                <span className="text-xs text-muted">
                  {ISSUE_LABEL.get(log.issueType) ?? log.issueType}
                  {log.issueTypeOther && ` — ${log.issueTypeOther}`}
                </span>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/on-call/CallLogList.tsx
git commit -m "feat(on-call): display issueTypeOther in CallLogList"
```

---

## Chunk 4: Verification

### Task 11: Build + type-check

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors (CSS warnings about `.print\:hidden` are expected and harmless).

- [ ] **Step 3: Fix any issues found, commit**

### Task 12: Manual testing

- [ ] **Step 1: Test admin button**

Log in as admin → navigate to `/dashboards/on-call` → verify "Got a call?" CTA appears → click "Log a call" → verify crew member picker dropdown appears at top → select an electrician, fill all fields, submit → verify call log appears in the list.

- [ ] **Step 2: Test "Other" write-in**

Open call log modal → select "Other" issue type → verify text input appears → try submitting without filling it → verify submit is blocked → fill it → submit → verify the list shows "Other — <your text>".

- [ ] **Step 3: Test electrician path unchanged**

Impersonate an electrician → navigate to on-call dashboard → verify "Log a call" button still works without the crew picker → submit a log → verify it saves.

- [ ] **Step 4: Test Google Sheet** (requires env setup)

1. Share the HR sheet with the service account email (Editor)
2. Set `ONCALL_HR_SHEET_ID=1OhWI89-UE7PGBjNLzut2ccL5m9S506QyFy-gOQZLu0k` in `.env`
3. Submit a call log → verify new row appears in the sheet within a few seconds
4. If sheet was empty, verify headers are in row 1

- [ ] **Step 5: Test silent fallback**

Remove `ONCALL_HR_SHEET_ID` from env → submit a call log → verify it saves normally without errors.

- [ ] **Step 6: Delete any test entries, commit final state**
