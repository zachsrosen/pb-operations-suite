# Survey Reassignment Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send amber-badged reassignment notification emails to both the previous and new surveyor when a site survey is reassigned.

**Architecture:** New React Email template (`ReassignmentNotification.tsx`) with a `direction` prop, a new `sendReassignmentNotification` sender function in `email.ts`, and hook-point modifications in both `route.ts` and `confirm/route.ts` that detect reassignment before the email send and conditionally replace the normal scheduling email.

**Tech Stack:** React Email, Resend (via `sendEmailMessage` transport), Next.js API routes, Jest

**Spec:** `docs/superpowers/specs/2026-03-16-survey-reassignment-notifications-design.md`

---

## Chunk 1: Email Template and Sender Function

### Task 1: Create `ReassignmentNotification.tsx` template

**Files:**
- Create: `src/emails/ReassignmentNotification.tsx`

- [ ] **Step 1: Create the React Email template**

Create `src/emails/ReassignmentNotification.tsx` following the exact structure of `src/emails/SchedulingNotification.tsx`. Uses `EmailShell` wrapper from `src/emails/_components/EmailShell.tsx`.

```tsx
import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface ReassignmentNotificationProps {
  crewMemberName: string;
  reassignedByName: string;
  otherSurveyorName: string;
  direction: "outgoing" | "incoming";
  customerName: string;
  customerAddress: string;
  formattedDate: string;
  timeSlot: string;
  dealOwnerName?: string | null;
  notes?: string;
  hubSpotDealUrl?: string;
  zuperJobUrl?: string;
  googleCalendarEventUrl?: string;
}

export function ReassignmentNotification({
  crewMemberName,
  reassignedByName,
  otherSurveyorName,
  direction,
  customerName,
  customerAddress,
  formattedDate,
  timeSlot,
  dealOwnerName,
  notes,
  hubSpotDealUrl,
  zuperJobUrl,
  googleCalendarEventUrl,
}: ReassignmentNotificationProps) {
  const isOutgoing = direction === "outgoing";
  const reassignmentLabel = isOutgoing
    ? `Now assigned to ${otherSurveyorName}`
    : `Previously assigned to ${otherSurveyorName}`;
  const hasLinks = !!hubSpotDealUrl || !!zuperJobUrl || (!isOutgoing && !!googleCalendarEventUrl);

  return (
    <EmailShell
      preview={`Site Survey Reassigned — ${customerName}`}
      subtitle="Survey Reassigned"
    >
      <Section style={card}>
        <Text style={badge}>SITE SURVEY REASSIGNED</Text>
        <Text style={customerNameText}>{customerName}</Text>
        <Hr style={divider} />

        <DetailRow icon="📍" label="Address" value={customerAddress} />
        <DetailRow icon="📅" label="Date" value={formattedDate} />
        <DetailRow icon="⏰" label="Time" value={timeSlot} />
        <DetailRow icon="👤" label="Reassigned by" value={reassignedByName} />
        {dealOwnerName && (
          <DetailRow icon="🧑‍💼" label="Deal owner" value={dealOwnerName} />
        )}

        {/* Reassignment context — text-explicit, not emoji-dependent */}
        <Section style={reassignmentBlock}>
          <Text style={reassignmentText}>
            {isOutgoing ? "→" : "←"} {reassignmentLabel}
          </Text>
        </Section>

        {notes && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Notes</Text>
            <Text style={detailBlockText}>{notes}</Text>
          </Section>
        )}

        {hasLinks && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Links</Text>
            {hubSpotDealUrl && (
              <Text style={detailBlockText}>
                <Link href={hubSpotDealUrl} style={link}>Open HubSpot Deal</Link>
              </Text>
            )}
            {zuperJobUrl && (
              <Text style={detailBlockText}>
                <Link href={zuperJobUrl} style={link}>Open Zuper Job</Link>
              </Text>
            )}
            {!isOutgoing && googleCalendarEventUrl && (
              <Text style={detailBlockText}>
                <Link href={googleCalendarEventUrl} style={link}>Open Google Calendar Event</Link>
              </Text>
            )}
          </Section>
        )}
      </Section>

      <Text style={footer}>
        Please check your Zuper app for complete details.
      </Text>

      {/* Invisible: used for plain-text only */}
      <Text style={hidden}>{crewMemberName}</Text>
    </EmailShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <Row style={row}>
      <Text style={rowLabel}>{icon} {label}</Text>
      <Text style={rowValue}>{value}</Text>
    </Row>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "24px",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  background: "linear-gradient(to right, #f59e0b, #fbbf24)",
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "16px",
};

const customerNameText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 16px 0",
  fontWeight: 600,
};

const divider: React.CSSProperties = {
  borderColor: "#1e1e2e",
  margin: "0 0 8px 0",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid #1e1e2e",
};

const rowLabel: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  margin: 0,
};

const rowValue: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  textAlign: "right",
};

const reassignmentBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  borderLeft: "3px solid #f59e0b",
  padding: "12px",
  marginTop: "16px",
};

const reassignmentText: React.CSSProperties = {
  color: "#fbbf24",
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
};

const detailBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  padding: "12px",
  marginTop: "16px",
};

const detailBlockLabel: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  margin: "0 0 6px 0",
};

const detailBlockText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  whiteSpace: "pre-line",
};

const link: React.CSSProperties = {
  color: "#60a5fa",
  textDecoration: "underline",
};

const footer: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  textAlign: "center",
  margin: 0,
};

const hidden: React.CSSProperties = {
  display: "none",
  maxHeight: 0,
  overflow: "hidden",
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

ReassignmentNotification.PreviewProps = {
  crewMemberName: "Derek Thompson",
  reassignedByName: "Sarah Miller",
  otherSurveyorName: "Sam Paro",
  direction: "outgoing",
  customerName: "Williams, Robert",
  customerAddress: "1234 Solar Lane, Denver, CO 80202",
  formattedDate: "Monday, March 16, 2026",
  timeSlot: "9:00 AM - 10:00 AM",
  dealOwnerName: "Mike Chen",
  hubSpotDealUrl: "https://app.hubspot.com/contacts/21710069/record/0-3/12345678901",
  zuperJobUrl: "https://web.zuperpro.com/jobs/123e4567-e89b-12d3-a456-426614174000/details",
} satisfies ReassignmentNotificationProps;

export default ReassignmentNotification;
```

- [ ] **Step 2: Verify template compiles**

Run: `npx tsc --noEmit src/emails/ReassignmentNotification.tsx 2>&1 || echo "Check errors above"`

Expected: No type errors. If tsc does not support single-file checks in this setup, run `npm run build` and check for email-related errors.

- [ ] **Step 3: Commit**

```bash
git add src/emails/ReassignmentNotification.tsx
git commit -m "feat: add ReassignmentNotification React Email template

Amber-badged email with direction prop (outgoing/incoming) for survey
reassignment notifications to both old and new surveyors."
```

---

### Task 2: Add `sendReassignmentNotification` to `email.ts`

**Files:**
- Modify: `src/lib/email.ts` (add after `sendCancellationNotification`, around line 895)

- [ ] **Step 1: Add the import for ReassignmentNotification at the top of `email.ts`**

In `src/lib/email.ts`, add after the existing `SchedulingNotification` import (line 6):

```typescript
import { ReassignmentNotification } from "@/emails/ReassignmentNotification";
```

- [ ] **Step 2: Add the interface and function after `sendCancellationNotification`**

Insert after the closing `}` of `sendCancellationNotification` (around line 895), before the `AvailabilityConflictItem` interface:

```typescript
interface SendReassignmentNotificationParams {
  to: string;
  crewMemberName: string;
  reassignedByName: string;
  reassignedByEmail: string;
  otherSurveyorName: string;
  direction: "outgoing" | "incoming";
  customerName: string;
  customerAddress: string;
  scheduledDate: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  projectId: string;
  zuperJobUid?: string;
  dealOwnerName?: string;
  notes?: string;
  googleCalendarEventUrl?: string;
}

export async function sendReassignmentNotification(
  params: SendReassignmentNotificationParams
): Promise<{ success: boolean; error?: string }> {
  const formattedDate = formatDate(params.scheduledDate);
  const timeSlot = params.scheduledStart && params.scheduledEnd
    ? `${formatTime(params.scheduledStart)} - ${formatTime(params.scheduledEnd)}`
    : "Full day";
  const defaultBcc = getSchedulingNotificationBccRecipients();
  const reassignerEmail = parseEmailAddress(params.reassignedByEmail);
  const bccRecipients = dedupeEmails(
    [...defaultBcc, ...(reassignerEmail ? [reassignerEmail] : [])],
    params.to,
  );
  const cleanedNotes = sanitizeScheduleEmailNotes(params.notes);
  const hubSpotDealUrl = getHubSpotDealUrl(params.projectId);
  const zuperJobUrl = getZuperJobUrl(params.zuperJobUid);
  const isOutgoing = params.direction === "outgoing";
  const directionLabel = isOutgoing
    ? `now assigned to ${params.otherSurveyorName}`
    : `previously assigned to ${params.otherSurveyorName}`;

  const html = await render(
    React.createElement(ReassignmentNotification, {
      crewMemberName: params.crewMemberName,
      reassignedByName: params.reassignedByName,
      otherSurveyorName: params.otherSurveyorName,
      direction: params.direction,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      formattedDate,
      timeSlot,
      dealOwnerName: params.dealOwnerName,
      notes: cleanedNotes,
      hubSpotDealUrl,
      zuperJobUrl: zuperJobUrl || undefined,
      googleCalendarEventUrl: !isOutgoing ? (params.googleCalendarEventUrl || undefined) : undefined,
    })
  );

  return sendEmailMessage({
    to: params.to,
    bcc: bccRecipients,
    subject: `Site Survey Reassigned - ${params.customerName}`,
    html,
    text: `Site Survey Reassigned

Hi ${params.crewMemberName},

A site survey appointment has been reassigned (${directionLabel}).

Customer: ${params.customerName}
Address: ${params.customerAddress}
Date: ${formattedDate}
Time: ${timeSlot}
Reassigned by: ${params.reassignedByName}
${params.dealOwnerName ? `Deal owner: ${params.dealOwnerName}\n` : ""}${cleanedNotes ? `Notes: ${cleanedNotes}\n` : ""}
HubSpot Deal: ${hubSpotDealUrl}
${zuperJobUrl ? `Zuper Job: ${zuperJobUrl}` : ""}
${!isOutgoing && params.googleCalendarEventUrl ? `Google Calendar Event: ${params.googleCalendarEventUrl}` : ""}

Please check your Zuper app for complete details.

- PB Operations`,
    debugFallbackTitle: `REASSIGNMENT NOTIFICATION (${params.direction}) for ${params.to}`,
    debugFallbackBody: [
      `Direction: ${params.direction}`,
      `Crew Member: ${params.crewMemberName}`,
      `Other Surveyor: ${params.otherSurveyorName}`,
      `Reassigned By: ${params.reassignedByName} (${params.reassignedByEmail})`,
      `Deal Owner: ${params.dealOwnerName || "N/A"}`,
      `Customer: ${params.customerName}`,
      `Address: ${params.customerAddress}`,
      `Date: ${formattedDate}`,
      `Time: ${timeSlot}`,
      `Notes: ${cleanedNotes || "None"}`,
      `HubSpot Deal: ${hubSpotDealUrl}`,
      `Zuper Job: ${zuperJobUrl || "None"}`,
      `Google Calendar Event: ${params.googleCalendarEventUrl || "None"}`,
      `BCC: ${bccRecipients.join(", ") || "None"}`,
    ].join("\n"),
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -20`

Expected: Build succeeds with no new errors related to `sendReassignmentNotification` or `ReassignmentNotification`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add sendReassignmentNotification in email.ts

Parallel to sendSchedulingNotification. Renders ReassignmentNotification
template, builds plain text fallback, handles BCC via sendEmailMessage."
```

---

### Task 3: Write tests for template and sender

**Files:**
- Create: `src/__tests__/emails/reassignment-notification.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
/**
 * Tests for ReassignmentNotification email template.
 *
 * Covers:
 *   1. Template renders outgoing variant with "Now assigned to" line
 *   2. Template renders incoming variant with "Previously assigned to" line
 *   3. Badge text is "SITE SURVEY REASSIGNED" in both variants
 *   4. Google Calendar link only appears for incoming
 *   5. Deal owner and notes rendering
 *
 * Note: sendReassignmentNotification sender tests are not included here
 * because the function lives in the same module as sendEmailMessage,
 * making same-module mocking unreliable. The sender is thin parameter
 * mapping over sendEmailMessage and the template (tested below).
 */

import { render } from "@react-email/render";
import * as React from "react";
import { ReassignmentNotification } from "@/emails/ReassignmentNotification";
import type { ReassignmentNotificationProps } from "@/emails/ReassignmentNotification";

const BASE_PROPS: ReassignmentNotificationProps = {
  crewMemberName: "Derek Thompson",
  reassignedByName: "Sarah Miller",
  otherSurveyorName: "Sam Paro",
  direction: "outgoing",
  customerName: "Williams, Robert",
  customerAddress: "1234 Solar Lane, Denver, CO 80202",
  formattedDate: "Monday, March 16, 2026",
  timeSlot: "9:00 AM - 10:00 AM",
  dealOwnerName: "Mike Chen",
  hubSpotDealUrl: "https://hubspot.com/deal/123",
  zuperJobUrl: "https://zuper.com/job/abc",
};

describe("ReassignmentNotification template", () => {
  it("renders outgoing variant with 'Now assigned to' line", async () => {
    const html = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      direction: "outgoing",
    }));
    expect(html).toContain("Now assigned to Sam Paro");
    expect(html).not.toContain("Previously assigned to");
  });

  it("renders incoming variant with 'Previously assigned to' line", async () => {
    const html = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      direction: "incoming",
      otherSurveyorName: "Derek Thompson",
      crewMemberName: "Sam Paro",
    }));
    expect(html).toContain("Previously assigned to Derek Thompson");
    expect(html).not.toContain("Now assigned to");
  });

  it("shows SITE SURVEY REASSIGNED badge in both variants", async () => {
    for (const direction of ["outgoing", "incoming"] as const) {
      const html = await render(React.createElement(ReassignmentNotification, {
        ...BASE_PROPS,
        direction,
      }));
      expect(html).toContain("SITE SURVEY REASSIGNED");
    }
  });

  it("shows Google Calendar link only for incoming", async () => {
    const calUrl = "https://calendar.google.com/event?eid=test";

    const outgoing = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      direction: "outgoing",
      googleCalendarEventUrl: calUrl,
    }));
    expect(outgoing).not.toContain(calUrl);

    const incoming = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      direction: "incoming",
      googleCalendarEventUrl: calUrl,
    }));
    expect(incoming).toContain(calUrl);
  });

  it("shows deal owner when provided", async () => {
    const html = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      dealOwnerName: "Mike Chen",
    }));
    expect(html).toContain("Mike Chen");
    expect(html).toContain("Deal owner");
  });

  it("shows notes when provided", async () => {
    const html = await render(React.createElement(ReassignmentNotification, {
      ...BASE_PROPS,
      notes: "Gate code is 4512",
    }));
    expect(html).toContain("Gate code is 4512");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx jest src/__tests__/emails/reassignment-notification.test.ts --verbose 2>&1`

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/emails/reassignment-notification.test.ts
git commit -m "test: add ReassignmentNotification template tests

Covers outgoing/incoming variants, badge text, Google Calendar link
visibility, deal owner, and notes rendering."
```

---

## Chunk 2: Refactor `resolvePrimarySurveyorEmailFromJob` and Hook into `route.ts`

### Task 4: Refactor `resolvePrimarySurveyorEmailFromJob` to return `PreviousSurveyorInfo`

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts` (lines 1947-1982)

- [ ] **Step 1: Add the `PreviousSurveyorInfo` interface**

Insert before the `resolvePrimarySurveyorEmailFromJob` function (around line 1947):

```typescript
interface PreviousSurveyorInfo {
  email: string | null;
  name: string | null;
  uid: string | null;
}
```

- [ ] **Step 2: Refactor the function return type and body**

Change the function signature from:

```typescript
async function resolvePrimarySurveyorEmailFromJob(
  jobUid: string,
  userCache?: ZuperUserLookupCache
): Promise<string | null> {
```

To:

```typescript
async function resolvePrimarySurveyorInfoFromJob(
  jobUid: string,
  userCache?: ZuperUserLookupCache
): Promise<PreviousSurveyorInfo> {
```

Replace the function body. The logic is the same email-resolution fallback chain, but now also captures `name` and `uid` from the `assigned_to[0].user` object:

```typescript
async function resolvePrimarySurveyorInfoFromJob(
  jobUid: string,
  userCache?: ZuperUserLookupCache
): Promise<PreviousSurveyorInfo> {
  const empty: PreviousSurveyorInfo = { email: null, name: null, uid: null };

  const jobResult = await zuper.getJob(jobUid);
  if (jobResult.type !== "success" || !jobResult.data) return empty;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignedUser = (jobResult.data as any)?.assigned_to?.[0]?.user;
  if (!assignedUser) return empty;

  const userUid = (assignedUser.user_uid || "").trim() || null;
  const fullName = [assignedUser.first_name, assignedUser.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  // Email resolution — same fallback chain as before
  const directEmail = normalizeEmail(assignedUser.email);
  if (directEmail) return { email: directEmail, name: fullName, uid: userUid };

  if (userUid) {
    const byUid = await getCrewMemberByZuperUserUid(userUid);
    const byUidEmail = normalizeEmail(byUid?.email);
    if (byUidEmail) return { email: byUidEmail, name: fullName || byUid?.name || null, uid: userUid };

    const zuperUser = await getCachedZuperUser(userUid, userCache);
    if (zuperUser.type === "success") {
      const zuperEmail = normalizeEmail(zuperUser.data?.email);
      const zuperName = [zuperUser.data?.first_name, zuperUser.data?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || null;
      if (zuperEmail) return { email: zuperEmail, name: zuperName || fullName, uid: userUid };
    }
  }

  if (fullName) {
    const byName = await getCrewMemberByName(fullName);
    const byNameEmail = normalizeEmail(byName?.email);
    if (byNameEmail) return { email: byNameEmail, name: fullName, uid: userUid };
  }

  return { email: null, name: fullName, uid: userUid };
}
```

- [ ] **Step 3: Update all call sites of the old function name**

Search for `resolvePrimarySurveyorEmailFromJob` in `route.ts`. It is called in the PUT handler where `previousSurveyorEmail` is resolved. Update the call site to use the new return type:

Old pattern:
```typescript
const previousSurveyorEmail = await resolvePrimarySurveyorEmailFromJob(existingJob.job_uid, options?.userCache);
```

New pattern:
```typescript
const previousSurveyorInfo = await resolvePrimarySurveyorInfoFromJob(existingJob.job_uid, options?.userCache);
```

Then wherever `previousSurveyorEmail` was passed (e.g., to `sendCrewNotification` via `options.previousSurveyorEmail`), pass `previousSurveyorInfo.email` instead. Also pass the full `previousSurveyorInfo` object so `sendCrewNotification` can access the name.

Use `grep` to find all references to `resolvePrimarySurveyorEmailFromJob` and `previousSurveyorEmail` in `route.ts` and update each one. The key places are:
- The PUT handler where the function is called (line ~784)
- The ScheduleRecord fallback (lines ~791-809) — this secondary path must also populate `previousSurveyorInfo`. When the Zuper job resolution returns empty and the fallback queries `prisma.scheduleRecord` + `resolveCrewNotificationRecipient`, construct a `PreviousSurveyorInfo` from the result:

```typescript
      if (!previousSurveyorInfo.email && prisma) {
        const previousRecord = await prisma.scheduleRecord.findFirst({
          where: {
            projectId: String(project.id),
            scheduleType: "survey",
            status: { in: ["scheduled", "tentative"] },
          },
          orderBy: { createdAt: "desc" },
          select: { assignedUser: true, assignedUserUid: true },
        });
        if (previousRecord) {
          const resolvedPrevious = await resolveCrewNotificationRecipient({
            assignedUser: previousRecord.assignedUser || undefined,
            assignedUserUid: previousRecord.assignedUserUid || undefined,
            userCache: zuperUserCache,
          });
          previousSurveyorInfo = {
            email: normalizeEmail(resolvedPrevious.recipientEmail),
            name: resolvedPrevious.recipientName || previousRecord.assignedUser || null,
            uid: previousRecord.assignedUserUid || null,
          };
        }
      }
```

- The `sendCrewNotification` call where `previousSurveyorEmail` is passed in `options` — change to pass `previousSurveyorInfo` instead

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | tail -20`

Expected: No type errors. The refactored function returns a richer object but the call sites are updated to extract `.email` where a string was expected.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "refactor: resolvePrimarySurveyorInfoFromJob returns name+uid+email

Enriches the return type from string|null to PreviousSurveyorInfo so
reassignment notifications can display the old surveyor's name."
```

---

### Task 5: Add reassignment email sends in `sendCrewNotification`

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts` (inside `sendCrewNotification`, lines ~1998-2267)

- [ ] **Step 1: Add import for `sendReassignmentNotification` at the top of `route.ts`**

Find the existing import from `@/lib/email`:

```typescript
import { sendSchedulingNotification, ... } from "@/lib/email";
```

Add `sendReassignmentNotification` to the import list.

- [ ] **Step 2: Update `sendCrewNotification` signature to accept `previousSurveyorInfo`**

Change the `options` parameter type from:

```typescript
options?: { previousSurveyorEmail?: string | null; userCache?: ZuperUserLookupCache }
```

To:

```typescript
options?: {
  previousSurveyorInfo?: PreviousSurveyorInfo | null;
  userCache?: ZuperUserLookupCache;
}
```

Update the call site in the PUT handler to pass `previousSurveyorInfo` instead of `previousSurveyorEmail`.

- [ ] **Step 3: Reorder reassignment detection before the email loop**

Currently the flow in `sendCrewNotification` is:
1. Resolve recipients (lines 2030-2066)
2. Resolve stakeholders (lines 2068-2085)
3. Resolve calendar link (lines 2086-2105)
4. **Send emails** (lines 2107-2126) ← emails sent here
5. **Detect reassignment** (lines 2129-2165) ← detection after emails
6. Calendar sync (lines 2167-2212)

The new flow moves reassignment detection before the email send and conditionally replaces the scheduling email:

After step 3 (calendar link resolution), insert the reassignment detection and conditional email logic **before** the existing email loop:

```typescript
    // ── Reassignment detection (surveys only) ─────────────────────────
    const previousSurveyorEmail = normalizeEmail(options?.previousSurveyorInfo?.email);
    const currentSurveyorEmail = normalizeEmail(primaryRecipientEmail);
    const isReassignment =
      schedule.type === "survey" &&
      !!previousSurveyorEmail &&
      !!currentSurveyorEmail &&
      previousSurveyorEmail !== currentSurveyorEmail;

    // Resolve old surveyor display name for reassignment emails
    let oldSurveyorDisplayName: string | null = null;
    let useReassignmentEmailForNewSurveyor = false;

    if (isReassignment) {
      // Fallback chain: name → email → "another surveyor"
      oldSurveyorDisplayName =
        options?.previousSurveyorInfo?.name ||
        previousSurveyorEmail ||
        null;

      // Only replace the scheduling email if we have meaningful context
      // (levels 1-3 of fallback chain: name or email resolved)
      useReassignmentEmailForNewSurveyor = !!oldSurveyorDisplayName;

      // Also check: new surveyor must be a real crew member, not scheduler fallback
      const newSurveyorIsSchedulerFallback =
        !recipientTargets[0]?.email || recipientTargets[0]?.email === schedulerEmail;
      if (newSurveyorIsSchedulerFallback) {
        useReassignmentEmailForNewSurveyor = false;
      }

      // Send outgoing reassignment to old surveyor
      try {
        await sendReassignmentNotification({
          to: previousSurveyorEmail,
          crewMemberName: options?.previousSurveyorInfo?.name || previousSurveyorEmail,
          reassignedByName: schedulerName,
          reassignedByEmail: schedulerEmail,
          otherSurveyorName: primaryRecipientName,
          direction: "outgoing",
          customerName,
          customerAddress,
          scheduledDate: schedule.date,
          scheduledStart: schedule.startTime,
          scheduledEnd: schedule.endTime,
          projectId: project.id,
          zuperJobUid,
          dealOwnerName,
        });
        console.log(`[Zuper Schedule] Reassignment outgoing notification sent to ${previousSurveyorEmail}`);
      } catch (outgoingErr) {
        console.warn(`[Zuper Schedule] Failed to send outgoing reassignment email to ${previousSurveyorEmail}:`, outgoingErr);
      }
    }

    // ── Send scheduling or reassignment emails ────────────────────────
    if (isReassignment && useReassignmentEmailForNewSurveyor) {
      // Send incoming reassignment to new surveyor (replaces normal scheduling email)
      for (const recipient of recipientTargets) {
        try {
          await sendReassignmentNotification({
            to: recipient.email,
            crewMemberName: recipient.name || schedule.assignedUser,
            reassignedByName: schedulerName,
            reassignedByEmail: schedulerEmail,
            otherSurveyorName: oldSurveyorDisplayName!,
            direction: "incoming",
            customerName,
            customerAddress,
            scheduledDate: schedule.date,
            scheduledStart: schedule.startTime,
            scheduledEnd: schedule.endTime,
            projectId: project.id,
            zuperJobUid,
            dealOwnerName,
            notes: schedule.notes,
            googleCalendarEventUrl,
          });
        } catch (incomingErr) {
          console.warn(`[Zuper Schedule] Failed to send incoming reassignment email to ${recipient.email}:`, incomingErr);
        }
      }
    } else {
      // Normal scheduling email (no reassignment or old identity unresolvable)
      for (const recipient of recipientTargets) {
        await sendSchedulingNotification({
          to: recipient.email,
          crewMemberName: recipient.name || schedule.assignedUser,
          scheduledByName: schedulerName,
          scheduledByEmail: schedulerEmail,
          dealOwnerName,
          projectManagerName,
          appointmentType: schedule.type as "survey" | "installation" | "inspection",
          customerName,
          customerAddress,
          scheduledDate: schedule.date,
          scheduledStart: schedule.startTime,
          scheduledEnd: schedule.endTime,
          projectId: project.id,
          zuperJobUid,
          googleCalendarEventUrl,
          notes: schedule.notes,
        });
      }
    }
```

Then **remove** the old reassignment detection that was after the email loop (the `previousSurveyorEmail` / `currentSurveyorEmail` comparison block at lines ~2130-2136), since it's now handled above. **Keep** the calendar cleanup block that follows it — just update it to use the `isReassignment` / `previousSurveyorEmail` / `currentSurveyorEmail` variables that are now defined earlier.

- [ ] **Step 4: Update the calendar cleanup block to use the pre-computed variables**

The calendar cleanup block currently re-derives `previousSurveyorEmail` and `currentSurveyorEmail` locally. Since those are now computed above, change the calendar block to use a simple `if (isReassignment)` guard instead of re-deriving the values. The body of the block stays identical.

- [ ] **Step 5: Verify it compiles**

Run: `npm run build 2>&1 | tail -20`

Expected: No type errors.

- [ ] **Step 6: Run existing tests**

Run: `npm run test 2>&1 | tail -20`

Expected: All existing tests still pass. No tests should break since we only changed internal notification flow, not test-facing APIs.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "feat: send reassignment emails in sendCrewNotification

Detects survey reassignment before email loop. Sends outgoing email
to old surveyor and incoming email to new surveyor. Falls back to
normal scheduling email if old surveyor identity is unresolvable."
```

---

## Chunk 3: Hook into `confirm/route.ts`

### Task 6: Add reassignment notification logic to `confirm/route.ts`

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/confirm/route.ts`

The confirm route has a different structure — it calls `sendSchedulingNotification` directly (line ~970) and has inline reassignment detection after the email send (line ~991). Note: `confirm/route.ts` has no `isTestMode` concept (unlike `route.ts` where `isTestMode` gates `sendCrewNotification`), so reassignment emails will always send on the confirm path. This is consistent with how `sendSchedulingNotification` already always sends on confirm.

The modification:

1. Moves reassignment detection before the email send
2. Extracts old surveyor name from raw Zuper job data (already fetched at lines ~596-614)
3. Resolves old surveyor email through the full fallback chain (already done for `previousSurveyorEmailFromJob`)
4. Conditionally sends reassignment emails instead of normal scheduling email

- [ ] **Step 1: Add import for `sendReassignmentNotification`**

Add to the existing email import in `confirm/route.ts`:

```typescript
import { sendSchedulingNotification, sendReassignmentNotification, ... } from "@/lib/email";
```

- [ ] **Step 2: Capture old surveyor name during the existing job fetch**

Around lines 596-614 where `previousSurveyorEmailFromJob` is resolved, also capture the name. The `assignedUser` variable at line 601 already has `first_name` and `last_name`. Add after line 602:

```typescript
const previousSurveyorNameFromJob = assignedUser
  ? [assignedUser.first_name, assignedUser.last_name].filter(Boolean).join(" ").trim() || null
  : null;
```

Declare `previousSurveyorNameFromJob` alongside `previousSurveyorEmailFromJob` in the outer scope (where `previousSurveyorEmailFromJob` is declared with `let`).

- [ ] **Step 3: Move reassignment detection before the `sendSchedulingNotification` call**

Before the `sendSchedulingNotification` call at line ~970, add:

```typescript
          // ── Reassignment detection (surveys only) ─────────────────────
          const previousSurveyorEmail = normalizeEmail(previousSurveyorEmailFromJob);
          const currentSurveyorEmail = normalizeEmail(recipientEmail);
          const isReassignment =
            scheduleType === "survey" &&
            !!previousSurveyorEmail &&
            !!currentSurveyorEmail &&
            previousSurveyorEmail !== currentSurveyorEmail;

          let oldSurveyorDisplayName: string | null = null;
          let useReassignmentEmailForNewSurveyor = false;

          if (isReassignment) {
            oldSurveyorDisplayName =
              previousSurveyorNameFromJob ||
              previousSurveyorEmail ||
              null;
            useReassignmentEmailForNewSurveyor = !!oldSurveyorDisplayName;

            // Don't send reassignment if new surveyor fell back to scheduler
            const newSurveyorIsSchedulerFallback = recipientEmail === session.user.email;
            if (newSurveyorIsSchedulerFallback) {
              useReassignmentEmailForNewSurveyor = false;
            }

            // Send outgoing to old surveyor
            try {
              await sendReassignmentNotification({
                to: previousSurveyorEmail,
                crewMemberName: previousSurveyorNameFromJob || previousSurveyorEmail,
                reassignedByName: session.user.name || session.user.email,
                reassignedByEmail: session.user.email,
                otherSurveyorName: recipientName || "the new surveyor",
                direction: "outgoing",
                customerName,
                customerAddress,
                scheduledDate: record.scheduledDate,
                scheduledStart: record.scheduledStart || undefined,
                scheduledEnd: record.scheduledEnd || undefined,
                projectId: record.projectId,
                zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
                dealOwnerName: dealOwnerName || undefined,
              });
              console.log(`[Zuper Confirm] Reassignment outgoing notification sent to ${previousSurveyorEmail}`);
            } catch (outgoingErr) {
              console.warn(`[Zuper Confirm] Failed to send outgoing reassignment email:`, outgoingErr);
            }
          }
```

- [ ] **Step 4: Wrap the existing `sendSchedulingNotification` call in a conditional**

Replace the direct `sendSchedulingNotification` call (lines ~970-989) with:

```typescript
          if (isReassignment && useReassignmentEmailForNewSurveyor) {
            await sendReassignmentNotification({
              to: recipientEmail,
              crewMemberName: recipientName,
              reassignedByName: session.user.name || session.user.email,
              reassignedByEmail: session.user.email,
              otherSurveyorName: oldSurveyorDisplayName!,
              direction: "incoming",
              customerName,
              customerAddress,
              scheduledDate: record.scheduledDate,
              scheduledStart: record.scheduledStart || undefined,
              scheduledEnd: record.scheduledEnd || undefined,
              projectId: record.projectId,
              zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
              dealOwnerName: dealOwnerName || undefined,
              notes: effectiveNotes || undefined,
              googleCalendarEventUrl,
            });
          } else {
            await sendSchedulingNotification({
              to: recipientEmail,
              crewMemberName: recipientName,
              scheduledByName: session.user.name || session.user.email,
              scheduledByEmail: session.user.email,
              dealOwnerName: dealOwnerName || undefined,
              projectManagerName: projectManagerName || undefined,
              appointmentType: scheduleType,
              customerName,
              customerAddress,
              scheduledDate: record.scheduledDate,
              scheduledStart: record.scheduledStart || undefined,
              scheduledEnd: record.scheduledEnd || undefined,
              projectId: record.projectId,
              zuperJobUid: zuperJobUid || record.zuperJobUid || undefined,
              googleCalendarEventUrl,
              notes: effectiveNotes || undefined,
              installDetails,
              bomEnrichment: bomEnrichment || undefined,
            });
          }
```

- [ ] **Step 5: Update the calendar cleanup block**

The calendar cleanup block at line ~991 currently re-derives `previousSurveyorEmail` and `currentSurveyorEmail`. Replace that derivation with the `isReassignment` variable already computed above. The calendar event deletion/creation logic inside the block stays identical.

Change:
```typescript
          if (scheduleType === "survey") {
            const previousSurveyorEmail = normalizeEmail(previousSurveyorEmailFromJob);
            const currentSurveyorEmail = normalizeEmail(recipientEmail);
            if (
              previousSurveyorEmail &&
              currentSurveyorEmail &&
              previousSurveyorEmail !== currentSurveyorEmail
            ) {
```

To:
```typescript
          if (isReassignment) {
```

The rest of the block uses `previousSurveyorEmail` and `currentSurveyorEmail` which are now defined in the outer scope above.

- [ ] **Step 6: Verify it compiles**

Run: `npm run build 2>&1 | tail -20`

Expected: No type errors.

- [ ] **Step 7: Run all tests**

Run: `npm run test 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/confirm/route.ts
git commit -m "feat: add reassignment notifications to confirm route

Mirrors route.ts pattern: detects survey reassignment before email
send, sends outgoing/incoming emails, preserves full email-resolution
fallback chain for old surveyor address."
```

---

## Chunk 4: Final Verification

### Task 7: Full build and lint verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build 2>&1 | tail -30`

Expected: Build succeeds with no new errors.

- [ ] **Step 2: Run full test suite**

Run: `npm run test 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -30`

Expected: No new lint errors introduced by these changes. Pre-existing warnings are acceptable.

- [ ] **Step 4: Commit any lint fixes if needed**

If lint reports fixable issues in the new code:

```bash
npm run lint -- --fix
git add -A
git commit -m "fix: lint cleanup for reassignment notification code"
```
