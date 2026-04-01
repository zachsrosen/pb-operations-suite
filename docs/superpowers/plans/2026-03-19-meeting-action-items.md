# Meeting Action Items — Construction Report, DA Report, Scheduling Approval

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three features from the 3/19 Derek/Zach meeting: construction completion time report by office, DA backlog/performance report, and scheduling approval workflow.

**Architecture:** Feature 1 extends the existing QC dashboard pattern with a new `/dashboards/construction-metrics` page backed by the existing `/api/stats` endpoint (already returns `constructionTurnaroundTime`). Feature 2 extends the D&E metrics dashboard with designer-level DA performance. Feature 3 adds a new Prisma model + API + UI for availability change requests.

**Tech Stack:** Next.js 16, React 19, Prisma 7, Tailwind v4, React Query v5, React Email

---

## Chunk 1: Construction Completion Time Report

Derek requested a report showing average start-to-completion times for construction projects across Westminster, Colorado Springs, and DTC (Centennial). HubSpot already stores `constructionTurnaroundTime` (days) and the QC dashboard (`/dashboards/qc`) already aggregates this metric by location.

### Task 1: Create Construction Metrics Dashboard Page

**Files:**
- Create: `src/app/dashboards/construction-metrics/page.tsx`
- Reference: `src/app/dashboards/qc/page.tsx` (copy pattern exactly)
- Reference: `src/app/api/stats/route.ts` (data source)

- [ ] **Step 1: Create the dashboard page file**

Create `src/app/dashboards/construction-metrics/page.tsx` modeled on the QC dashboard. Key differences from QC:
- Title: "Construction Completion Metrics"
- Accent color: "orange"
- Focus metrics: `avg_constructionTurnaroundTime`, `avg_timeRtbToConstructionSchedule`, `avg_timeRtbToCc`
- Additional detail metrics: `avg_projectTurnaroundTime`, `avg_timeToPto`
- Threshold for construction turnaround: [7, 14, 30] days (green/yellow/orange/red)

```tsx
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";

const METRIC_COLUMNS = [
  { key: "avg_timeRtbToConstructionSchedule", label: "RTB → Scheduled", shortLabel: "RTB→Sched", thresholds: [7, 14, 30] },
  { key: "avg_constructionTurnaroundTime", label: "Construction Duration", shortLabel: "Constr", thresholds: [7, 14, 30] },
  { key: "avg_timeRtbToCc", label: "RTB → Complete", shortLabel: "RTB→CC", thresholds: [14, 30, 60] },
  { key: "avg_timeCcToPto", label: "CC → PTO", shortLabel: "CC→PTO", thresholds: [20, 40, 60] },
] as const;

const DETAIL_METRICS = [
  { key: "avg_projectTurnaroundTime", label: "Full Project Turnaround" },
  { key: "avg_timeToPto", label: "Sale → PTO" },
  { key: "avg_timeToCc", label: "Sale → CC" },
  { key: "avg_timeToRtb", label: "Sale → RTB" },
] as const;
```

Follow the exact QC dashboard structure:
- `DAYS_OPTIONS` selector (60/90/180/365/All Time)
- `LOCATIONS` array: `["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"]`
- Fetch from `/api/stats` with React Query
- Color-coded table with `getCellColor()` / `getCellBg()` helpers (copy from QC)
- Show `byLocation` rows with project counts
- Show `totals` row at bottom
- `DashboardShell` wrapper with `accentColor="orange"`, `fullWidth={true}`

- [ ] **Step 2: Verify the page renders**

Run: `npm run dev`
Navigate to: `http://localhost:3000/dashboards/construction-metrics`
Expected: Dashboard loads with location-by-metric table showing construction turnaround data

- [ ] **Step 3: Add route to suite navigation**

Modify: `src/lib/suite-nav.ts`

Add the new dashboard under the Operations suite links so it's discoverable:

```typescript
{ label: "Construction Metrics", href: "/dashboards/construction-metrics", icon: "..." }
```

- [ ] **Step 4: Verify navigation works**

Navigate via the Operations suite page to confirm the link works.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/construction-metrics/page.tsx src/lib/suite-nav.ts
git commit -m "feat(construction): add construction completion metrics dashboard by location"
```

---

## Chunk 2: DA Performance Report

Extend the existing D&E Metrics dashboard with designer-level DA performance tracking — specifically to monitor DAS submission volume, turnaround, and backlog per designer (Jacob in particular).

### Task 2: Add DA Performance Section to D&E Metrics

**Files:**
- Modify: `src/app/dashboards/de-metrics/page.tsx`
- Reference: `src/lib/types.ts` for `RawProject` DA fields

The D&E Metrics page already has:
- DA Turnaround calculation (sent → approved)
- Approval rate metrics
- Monthly trend charts
- Designer table with sort

What to ADD to the existing page:

- [ ] **Step 1: Add DA Backlog Aging section**

Modify: `src/app/dashboards/de-metrics/page.tsx`

After the existing designer performance table, add a "DA Backlog" section that shows projects where DA has been sent but not yet approved, sorted by days waiting:

```tsx
// Add to the computed data section
const daBacklog = useMemo(() => {
  return safeProjects
    .filter(p => p.designApprovalSentDate && !p.designApprovalDate)
    .map(p => {
      const sentDate = new Date(p.designApprovalSentDate!);
      const daysWaiting = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
      return { ...p, daysWaiting };
    })
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
}, [safeProjects]);
```

Render as a table with columns: Project, Designer, Days Waiting, Location, Status.
Use red highlight for > 14 days, orange for > 7 days.

- [ ] **Step 2: Add DA Submission Rate per Designer section**

Add a bar chart or table showing weekly DA submission volume per designer over the last 8 weeks. Use `designApprovalSentDate` to count submissions per week:

```tsx
const daWeeklyByDesigner = useMemo(() => {
  const now = Date.now();
  const eightWeeksAgo = now - 56 * 24 * 60 * 60 * 1000;

  return safeProjects
    .filter(p => p.designApprovalSentDate && new Date(p.designApprovalSentDate).getTime() > eightWeeksAgo)
    .reduce((acc, p) => {
      const designer = p.designLead || "Unassigned";
      const week = getWeekLabel(new Date(p.designApprovalSentDate!));
      acc[designer] = acc[designer] || {};
      acc[designer][week] = (acc[designer][week] || 0) + 1;
      return acc;
    }, {} as Record<string, Record<string, number>>);
}, [safeProjects]);
```

- [ ] **Step 3: Verify new sections render**

Run: `npm run dev`
Navigate to: `http://localhost:3000/dashboards/de-metrics`
Expected: New DA Backlog and Submission Rate sections appear below existing content

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/de-metrics/page.tsx
git commit -m "feat(design): add DA backlog aging and designer submission rate to D&E metrics"
```

---

## Chunk 3: Scheduling Approval Workflow

When staff change their availability via the self-service endpoint, the change should go into a pending state and require manager/admin approval before taking effect.

### Task 3: Add Prisma Model for Availability Change Requests

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the AvailabilityChangeRequest model**

```prisma
model AvailabilityChangeRequest {
  id              String   @id @default(cuid())
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  requestType     String   // "add" | "modify" | "delete"
  dayOfWeek       Int?     // 0-6 for recurring availability
  startTime       String?  // "HH:MM" for recurring
  endTime         String?  // "HH:MM" for recurring
  overrideDate    String?  // YYYY-MM-DD for date-specific overrides
  isAvailable     Boolean  @default(true)
  reason          String?

  // Original slot ID if modifying/deleting existing
  originalSlotId  String?

  status          String   @default("pending") // "pending" | "approved" | "rejected"
  reviewedBy      String?
  reviewedAt      DateTime?
  reviewNote      String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([crewMemberId])
  @@index([status])
}
```

Also add to CrewMember:
```prisma
availabilityRequests AvailabilityChangeRequest[]
```

- [ ] **Step 2: Run migration**

Run: `npx prisma migrate dev --name add-availability-change-requests`
Expected: Migration succeeds, new table created

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(scheduling): add AvailabilityChangeRequest model"
```

### Task 4: Add API Endpoints for Approval Workflow

**Files:**
- Modify: `src/app/api/zuper/my-availability/route.ts` (change POST/PUT/DELETE to create requests)
- Create: `src/app/api/admin/availability-requests/route.ts` (list pending, approve, reject)

- [ ] **Step 1: Modify self-service endpoint to create requests**

In `src/app/api/zuper/my-availability/route.ts`, change the POST handler so that instead of calling `upsertCrewAvailability()` directly, it creates an `AvailabilityChangeRequest` with status "pending":

```typescript
// POST — instead of direct upsert:
const request = await prisma.availabilityChangeRequest.create({
  data: {
    crewMemberId: crewMember.id,
    requestType: "add",
    dayOfWeek: body.dayOfWeek,
    startTime: body.startTime,
    endTime: body.endTime,
    reason: body.reason,
    status: "pending",
  },
});
// Send notification email to approvers
```

Same pattern for PUT (requestType: "modify") and DELETE (requestType: "delete").

- [ ] **Step 2: Create admin approval endpoint**

Create `src/app/api/admin/availability-requests/route.ts`:

- GET: List pending requests (joins CrewMember for display name)
- POST: Approve or reject a request
  - On approve: apply the change via `upsertCrewAvailability()` or `deleteCrewAvailability()`
  - On reject: update status to "rejected" with reviewNote
  - Both: log activity, send email notification to requester

```typescript
// POST body: { requestId: string, action: "approve" | "reject", note?: string }
```

Gate with: `canManageAvailability` OR `ADMIN` role (same as existing crew-availability endpoint).

- [ ] **Step 3: Verify endpoints work**

Test with curl or browser dev tools:
1. POST to `/api/zuper/my-availability` creates a pending request
2. GET `/api/admin/availability-requests` shows the pending request
3. POST `/api/admin/availability-requests` with approve action applies the change

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/my-availability/route.ts src/app/api/admin/availability-requests/route.ts
git commit -m "feat(scheduling): add approval workflow for availability changes"
```

### Task 5: Add Email Notification Template

**Files:**
- Create: `src/emails/AvailabilityApprovalRequest.tsx`

- [ ] **Step 1: Create email template**

Model on existing `SchedulingNotification.tsx`. Include:
- Crew member name and requested change details
- Link to approval queue in admin dashboard
- Timestamp of request

- [ ] **Step 2: Preview email**

Run: `npm run email:preview`
Expected: New template renders correctly

- [ ] **Step 3: Commit**

```bash
git add src/emails/AvailabilityApprovalRequest.tsx
git commit -m "feat(scheduling): add email template for availability approval requests"
```

### Task 6: Add Approval Queue UI

**Files:**
- Create: `src/app/dashboards/availability-approvals/page.tsx`

- [ ] **Step 1: Create approval queue page**

Simple table page showing pending availability change requests:
- Columns: Crew Member, Request Type, Day/Date, Time, Reason, Requested At
- Action buttons: Approve / Reject (with optional note modal)
- Filter: pending / approved / rejected tabs
- Wrap in `DashboardShell` with `accentColor="blue"`

Fetch from `/api/admin/availability-requests` with React Query.

- [ ] **Step 2: Add to Admin suite navigation**

Modify: `src/lib/suite-nav.ts`

Add under Admin suite links:
```typescript
{ label: "Availability Approvals", href: "/dashboards/availability-approvals", icon: "..." }
```

- [ ] **Step 3: Verify end-to-end flow**

1. Log in as a crew member, submit an availability change
2. Log in as admin, see pending request in approval queue
3. Approve the request, verify availability is updated
4. Verify email notification sent

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/availability-approvals/page.tsx src/lib/suite-nav.ts
git commit -m "feat(scheduling): add availability approval queue dashboard"
```
