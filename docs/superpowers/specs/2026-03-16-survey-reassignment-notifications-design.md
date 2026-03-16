# Survey Reassignment Notifications

**Date**: 2026-03-16
**Status**: Approved
**Scope**: Site survey reassignment emails only (not installations or inspections)

## Problem

When a site survey is reassigned from one surveyor to another, the previous surveyor receives no notification. Their Google Calendar events are silently deleted, and the new surveyor receives a standard "New Site Survey Scheduled" email with no context about the handoff. The previous surveyor has no way to know the survey was taken off their plate without manually checking Zuper.

## Solution

Send reassignment-specific notification emails to both surveyors when a site survey is reassigned:

- **Previous surveyor** ("outgoing"): Told the survey was reassigned and to whom
- **New surveyor** ("incoming"): Gets a full scheduling email (same content as the normal scheduling notification) with added context about who they are replacing

## Design

### Email Template: `ReassignmentNotification.tsx`

A new React Email component using the existing `EmailShell` wrapper.

**Visual treatment:**
- Amber/yellow badge (`#f59e0b` gradient) with "SITE SURVEY REASSIGNED"
- Same dark card layout as `SchedulingNotification.tsx`
- Detail rows: customer name, address, date, time, reassigned by, deal owner
- Reassignment context line (text-explicit, not emoji-dependent):
  - Outgoing: "Now assigned to [New Surveyor Name]"
  - Incoming: "Previously assigned to [Old Surveyor Name]"
- Links section: HubSpot deal, Zuper job (same as scheduling email)
- No BOM/install details (surveys only)

**Props:**

```typescript
interface ReassignmentNotificationProps {
  crewMemberName: string;           // Recipient's name
  reassignedByName: string;         // Who made the change
  otherSurveyorName: string;        // The "other side" name
  direction: "outgoing" | "incoming";
  customerName: string;
  customerAddress: string;
  formattedDate: string;            // Pre-formatted: "Friday, March 16, 2026"
  timeSlot: string;                 // Pre-formatted: "9:00 AM - 10:00 AM" | "Full day"
  dealOwnerName?: string | null;
  notes?: string;
  hubSpotDealUrl?: string;
  zuperJobUrl?: string;
  googleCalendarEventUrl?: string;  // Only for incoming direction
}
```

The `direction` prop controls:
- Badge sub-text and preview text
- Which reassignment context line renders
- Whether Google Calendar link is included (only for incoming)

### Email Sender: `sendReassignmentNotification` in `email.ts`

New function parallel to `sendSchedulingNotification` and `sendCancellationNotification`.

```typescript
interface SendReassignmentNotificationParams {
  to: string;
  crewMemberName: string;
  reassignedByName: string;
  reassignedByEmail: string;        // Used for BCC only, not displayed in template
  otherSurveyorName: string;
  direction: "outgoing" | "incoming";
  customerName: string;
  customerAddress: string;
  scheduledDate: string;            // YYYY-MM-DD
  scheduledStart?: string;
  scheduledEnd?: string;
  projectId: string;
  zuperJobUid?: string;
  dealOwnerName?: string;
  notes?: string;
  googleCalendarEventUrl?: string;
}
```

- Subject: `"Site Survey Reassigned - {customerName}"`
- Renders `ReassignmentNotification` template + plain text fallback
- BCC: `getSchedulingNotificationBccRecipients()` + reassigner email (same pattern as scheduling)
- `reassignedByEmail` is used only for BCC, not displayed in the email body
- Called twice per reassignment: once outgoing, once incoming

### Hook Point: `sendCrewNotification` in `route.ts`

The existing reassignment detection block (lines 2130-2136) already identifies when `previousSurveyorEmail !== currentSurveyorEmail`. The change reorders the logic so that reassignment detection happens **before** the email send loop (currently lines 2107-2126), not after.

New flow within `sendCrewNotification` for surveys:

1. Resolve recipient targets (existing loop, unchanged)
2. Resolve `previousSurveyorEmail` and `currentSurveyorEmail` (moved earlier)
3. **If reassignment detected** (`previous !== current`, both non-null):
   a. Resolve old surveyor's identity (name + email) via the fallback chain
   b. Send `sendReassignmentNotification` with `direction: "outgoing"` to old surveyor
   c. If old identity resolved (levels 1-3): send `sendReassignmentNotification` with `direction: "incoming"` to new surveyor **instead of** normal `sendSchedulingNotification`
   d. If old identity unresolvable (level 4 only): send normal `sendSchedulingNotification` to new surveyor
4. **If no reassignment**: send normal `sendSchedulingNotification` via existing `recipientTargets` loop (unchanged)
5. Calendar sync (unchanged)

**Multi-recipient handling:** Site surveys are always single-assignee, but the existing code loops over `recipientTargets`. The reassignment replacement applies to the primary recipient only. If there are additional BCC/fallback recipients in the loop, they receive the same email variant as the primary (reassignment or normal). This keeps the loop structure intact.

**Scheduler email fallback:** If the new surveyor's email is unresolvable and falls back to `schedulerEmail`, no reassignment emails are sent (since the "new surveyor" is actually just the scheduler). The normal scheduling notification goes to the scheduler fallback as it does today.

**`isTestMode` guard:** Reassignment emails respect the same `isTestMode` check that gates `sendCrewNotification`. No reassignment emails are sent during test slot operations.

**Condition for replacing the normal scheduling email:** The incoming reassignment email replaces `sendSchedulingNotification` for the new surveyor if and only if:
- Reassignment was detected (previous !== current email)
- The old surveyor's identity was resolved to at least a name or email (so the "Previously assigned to" line has meaningful content)
- The new surveyor email was resolved to a real crew member (not the scheduler fallback)

If the old surveyor's identity is completely unresolvable (no name, no email), the new surveyor receives the normal scheduling email instead, since the reassignment context would be empty.

**Calendar behavior is unchanged.** This spec only adds email notifications. The existing calendar event deletion (old surveyor) and creation (new surveyor) logic is intentionally out of scope.

### Hook Point: `confirm/route.ts` (separate modification)

`confirm/route.ts` does **not** use `sendCrewNotification` — it calls `sendSchedulingNotification` directly (around line 970) and has its own inline reassignment detection (around line 991). The modification pattern differs from `route.ts`:

1. Move the reassignment detection (currently after the email send at ~line 991) to **before** the `sendSchedulingNotification` call (~line 970)
2. The previous surveyor's UID and name are available from the raw Zuper job data at `assigned_to[0].user` (lines ~596-614), which provides `first_name` and `last_name` directly — no additional lookup needed
3. If reassignment detected:
   a. Send outgoing reassignment email to previous surveyor
   b. Send incoming reassignment email to new surveyor (replacing the direct `sendSchedulingNotification` call)
4. If no reassignment: send normal `sendSchedulingNotification` as today
5. Calendar cleanup proceeds unchanged after emails

### Refactoring `resolvePrimarySurveyorEmailFromJob`

The existing `resolvePrimarySurveyorEmailFromJob` (line 1947 of `route.ts`) returns only `string | null` (an email). To support reassignment notifications, it needs to return a richer result:

```typescript
interface PreviousSurveyorInfo {
  email: string | null;
  name: string | null;
  uid: string | null;
}
```

The function already has access to the Zuper job's `assigned_to` array internally — the refactor surfaces the name and UID that are currently discarded. In `confirm/route.ts`, the same data is available inline from the raw job response.

### Old Surveyor Identity Fallback Chain

When resolving the old surveyor's display name for the "other side" context line:

1. Live Zuper user name (from `resolvePrimarySurveyorEmailFromJob` enriched result, or `getCachedZuperUser` by UID)
2. Local `CrewMember` record name (by UID or name match)
3. Old surveyor's email address (still informative)
4. `"another surveyor"` (last resort)

Levels 1-3 are considered "resolved" and allow the incoming reassignment email to replace the normal scheduling email. Level 4 is not — the new surveyor gets a normal scheduling email instead.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Old surveyor email unresolvable | Skip outgoing email, log warning. New surveyor still gets incoming reassignment or normal scheduling email. |
| Old surveyor name unresolvable but email known | Outgoing email sent. Incoming uses email as fallback in "Previously assigned to" line. |
| Old surveyor completely unresolvable (no name, no email) | No outgoing email. New surveyor gets normal scheduling email (not reassignment). |
| New surveyor is same as old (normalized) | No reassignment detected. Normal scheduling flow runs unchanged. |
| New surveyor email fell back to scheduler | No reassignment emails. Normal scheduling email to scheduler fallback. |
| Email send failure | Catch and log. Never throw. Scheduling operation succeeds regardless. |
| Reassignment notification fails but calendar sync succeeds | Acceptable. Calendar is the source of truth; email is informational. |

### Files to Create

| File | Purpose |
|------|---------|
| `src/emails/ReassignmentNotification.tsx` | React Email template with `direction` prop |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/email.ts` | Add `sendReassignmentNotification` function and `SendReassignmentNotificationParams` interface |
| `src/app/api/zuper/jobs/schedule/route.ts` | Refactor `resolvePrimarySurveyorEmailFromJob` to return `PreviousSurveyorInfo`; reorder `sendCrewNotification` to detect reassignment before email loop; conditionally send reassignment emails |
| `src/app/api/zuper/jobs/schedule/confirm/route.ts` | Move reassignment detection before `sendSchedulingNotification` call; add reassignment email sends using inline Zuper job data for old surveyor identity |

### Out of Scope

- **Calendar behavior**: Unchanged. Event deletion/creation stays as-is.
- **Activity logging**: No new `SURVEY_REASSIGNED` activity type. Can be added later if the team wants audit trail.
- **`waitUntil` deferral**: Both emails run on the request path, same as existing `sendSchedulingNotification`. Optimization via `waitUntil` for the outgoing email is a future enhancement.
- **Installation/inspection reassignment**: Only surveys are covered. Inspections (single-person) could be added later with the same pattern.

### Test Plan

**Unit: `ReassignmentNotification.tsx`**
- Renders outgoing variant with correct "Now assigned to" line
- Renders incoming variant with correct "Previously assigned to" line
- Badge text is "SITE SURVEY REASSIGNED" in both
- Google Calendar link only appears for incoming

**Unit: `sendReassignmentNotification`**
- Mocks Resend, verifies subject line
- Verifies BCC includes ops recipients + reassigner
- Outgoing and incoming produce different email body content
- `reassignedByEmail` appears in BCC but not in rendered HTML

**Integration: schedule route reassignment flow**
- PUT with different `assignedUser` than existing job triggers reassignment detection
- `sendReassignmentNotification` called twice (outgoing + incoming)
- `sendSchedulingNotification` is NOT called for new surveyor when old identity is resolved
- `sendSchedulingNotification` IS called for new surveyor when old identity is completely unresolvable
- No reassignment emails when new surveyor falls back to scheduler email

**Fallback tests:**
- Old surveyor email unresolvable: only incoming sent, no outgoing
- Old surveyor name unresolvable but email known: outgoing sent, incoming uses email as "Previously assigned to"
- Same surveyor (same normalized email): no reassignment emails, normal scheduling email sent

**Parity: `confirm/route.ts`**
- Same reassignment detection and notification behavior as `route.ts`
- Uses inline Zuper job data for old surveyor identity (not `resolvePrimarySurveyorEmailFromJob`)

**Test mode:**
- Reassignment emails are not sent when `isTestMode` is true
