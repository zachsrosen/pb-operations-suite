# Customer Portal: Site Survey Self-Scheduling (MVP)

## Overview

Customers receive a unique tokenized link (via email) tied to their HubSpot deal. They click it, see available survey time slots for their location, and book directly. No login required.

**Flow:** Sales/ops triggers invite → customer gets email → clicks link → picks slot → survey booked in Zuper → confirmation sent.

---

## 1. Database Schema Changes

Add to `prisma/schema.prisma`:

### `SurveyInvite` model
```prisma
model SurveyInvite {
  id              String    @id @default(cuid())
  token           String    @unique                // crypto-random, URL-safe
  dealId          String                           // HubSpot deal ID
  customerEmail   String
  customerName    String
  customerPhone   String?
  propertyAddress String                           // survey site address
  pbLocation      String                           // Westminster, Centennial, etc.
  systemSize      Float?                           // kW, from deal
  status          SurveyInviteStatus @default(PENDING)
  expiresAt       DateTime                         // token TTL (default 14 days)
  scheduledAt     DateTime?                        // when customer booked
  scheduledDate   String?                          // YYYY-MM-DD
  scheduledTime   String?                          // HH:MM
  crewMemberId    String?                          // assigned crew member
  scheduleRecordId String?                         // link to ScheduleRecord
  zuperJobUid     String?                          // Zuper job UID once created
  accessNotes     String?                          // customer-provided gate codes, dogs, etc.
  sentAt          DateTime?                        // when invite email was sent
  sentBy          String?                          // internal user who triggered it
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([dealId])
  @@index([customerEmail])
  @@index([token])
  @@index([status])
}

enum SurveyInviteStatus {
  PENDING      // invite sent, awaiting customer action
  SCHEDULED    // customer booked a slot
  RESCHEDULED  // customer changed their slot
  EXPIRED      // token past expiry
  CANCELLED    // cancelled by ops or customer
  COMPLETED    // survey done
}
```

---

## 2. New Files & Routes

### Public Portal Page (no auth required)
```
src/app/portal/survey/[token]/page.tsx        # Customer-facing scheduling page
src/app/portal/survey/[token]/layout.tsx      # Minimal layout (no DashboardShell, no nav)
src/app/portal/survey/[token]/confirmation/page.tsx  # Post-booking confirmation
```

### Public API Routes (token-validated, no next-auth)
```
src/app/api/portal/survey/[token]/route.ts          # GET: invite details + available slots
src/app/api/portal/survey/[token]/book/route.ts     # POST: book a slot
src/app/api/portal/survey/[token]/reschedule/route.ts  # PUT: change booking (if allowed)
src/app/api/portal/survey/[token]/cancel/route.ts   # POST: cancel booking
```

### Internal API Routes (auth required)
```
src/app/api/portal/survey/invite/route.ts    # POST: create invite + send email
src/app/api/portal/survey/invites/route.ts   # GET: list invites (for dashboard)
```

### Shared Utilities
```
src/lib/portal-token.ts          # Token generation + validation helpers
src/lib/portal-availability.ts   # Compute available slots for customer view
```

### Email Template
```
src/emails/SurveyInviteEmail.tsx       # "Schedule your site survey" email
src/emails/SurveyConfirmationEmail.tsx # Booking confirmation to customer
```

### Internal Dashboard Integration
```
src/app/dashboards/survey-invites/page.tsx   # Track invite statuses (optional, phase 2)
```

---

## 3. Implementation Steps

### Step 1: Schema + Token Infrastructure
- Add `SurveyInvite` model and enum to Prisma schema
- Run `npx prisma generate` (no migration needed for Neon — will use `prisma db push` or migration)
- Create `src/lib/portal-token.ts`:
  - `generateToken()` — 32-byte crypto-random, base64url-encoded
  - `validateToken(token)` — fetch invite, check expiry + status

### Step 2: Availability Computation for Portal
- Create `src/lib/portal-availability.ts`:
  - Reuse existing `CrewAvailability` + `BookedSlot` + `AvailabilityOverride` queries
  - Compute available survey slots for a given `pbLocation` over the next 14 days
  - Return slots grouped by date: `{ date: string, slots: { time: string, crewMemberId: string }[] }`
  - Apply business rules: no same-day booking, minimum 2-day lead time for sales-originated invites
  - Hide crew member identity from customer (just show time slots)

### Step 3: Public API Endpoints
- **GET `/api/portal/survey/[token]`**
  - Validate token (exists, not expired, status PENDING or SCHEDULED)
  - Return: customer name, property address, available slots, current booking (if any)
  - Rate limit: 20 requests/minute per token
  - Do NOT expose internal IDs, crew names, or deal details

- **POST `/api/portal/survey/[token]/book`**
  - Body: `{ date: string, time: string, accessNotes?: string }`
  - Validate: token valid, slot still available (re-check), status is PENDING
  - Book slot via existing `BookedSlot` creation logic
  - Create `ScheduleRecord` (source: "customer_portal")
  - Create Zuper job via `ZuperClient.createJobFromProject()`
  - Update `SurveyInvite` status → SCHEDULED
  - Send confirmation email to customer
  - Send internal notification to ops team
  - Log activity (SURVEY_SCHEDULED, source: customer_portal)

- **PUT `/api/portal/survey/[token]/reschedule`**
  - Only if current status is SCHEDULED and survey date is >24h away
  - Free old slot, book new slot, update Zuper job schedule
  - Update status → RESCHEDULED
  - Send updated confirmation to customer + internal notification

- **POST `/api/portal/survey/[token]/cancel`**
  - Only if status is SCHEDULED and survey date is >24h away
  - Free slot, update Zuper job status
  - Update status → CANCELLED
  - Send cancellation emails

### Step 4: Customer-Facing UI
- **Layout** (`portal/survey/[token]/layout.tsx`):
  - Minimal: PB logo, no sidebar/nav, no auth checks
  - Responsive, mobile-first (customers will use phones)
  - Theme tokens for consistency but simpler than internal dashboards

- **Main Page** (`portal/survey/[token]/page.tsx`):
  - Fetch invite + slots via API on load
  - Show: greeting with customer name, property address, instructions
  - Calendar date picker (next 14 days, disabled dates with no availability)
  - Time slot grid for selected date
  - Access notes textarea ("Gate codes, pets, parking instructions...")
  - Confirm button → book API call → redirect to confirmation page
  - States: loading, invalid/expired token, already scheduled (show booking), available

- **Confirmation Page** (`portal/survey/[token]/confirmation`):
  - Show: date, time, address, what to expect
  - "Add to Calendar" link (Google Calendar / .ics download)
  - Reschedule / Cancel buttons (if within allowed window)
  - Contact info for questions

### Step 5: Internal Invite API + Email
- **POST `/api/portal/survey/invite`** (requires auth, canScheduleSurveys permission):
  - Body: `{ dealId, customerEmail, customerName, propertyAddress, pbLocation, systemSize? }`
  - Generate token, create SurveyInvite (status: PENDING, expiresAt: now + 14 days)
  - Send invite email via Resend using `SurveyInviteEmail` template
  - Log activity

- **SurveyInviteEmail template**:
  - Subject: "Schedule Your Site Survey — Photon Brothers"
  - Body: greeting, explain what a site survey is, CTA button to portal URL
  - Clean, branded, mobile-friendly

- **SurveyConfirmationEmail template**:
  - Subject: "Your Site Survey is Confirmed"
  - Body: date/time, address, what to expect, reschedule/cancel links
  - Calendar attachment (.ics)

### Step 6: Integration with Existing Scheduler
- Add "Send Portal Invite" button to site survey scheduler dashboard
  - On the project row or detail panel, button to trigger invite creation
  - Pre-fills customerEmail, name, address from HubSpot deal data
  - Shows invite status if one already exists for that deal
- Add `source: "customer_portal"` tracking to ScheduleRecord for analytics

---

## 4. Security Considerations

- **Tokens**: 32-byte crypto-random (256-bit entropy), base64url-encoded, 44 chars
- **Expiry**: 14-day default, configurable per invite
- **Rate limiting**: Per-token and per-IP limits on public endpoints
- **Input validation**: Zod schemas on all API inputs
- **No sensitive data exposure**: Hide crew IDs, deal IDs, internal status from customer responses
- **CSRF**: Not needed for token-validated GET/POST (token itself acts as CSRF token)
- **Slot race conditions**: Re-validate availability at booking time inside a transaction
- **Audit trail**: All portal actions logged to ActivityLog with `source: "customer_portal"`

---

## 5. Files Modified (Existing)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `SurveyInvite` model + `SurveyInviteStatus` enum |
| `src/lib/role-permissions.ts` | Add portal invite permissions if needed |
| `src/app/dashboards/site-survey-scheduler/page.tsx` | Add "Send Invite" button per project |
| `src/lib/zuper.ts` | No changes needed (reuse existing job creation) |
| `src/lib/email.ts` | Add portal email sending functions |
| `next.config.ts` | Ensure `/portal/*` routes are not behind auth middleware |

---

## 6. Out of Scope (Future Phases)

- Customer account system / login
- Project status tracker
- Document upload / viewing
- In-portal messaging
- Multi-survey booking
- HubSpot workflow automation (auto-send invites at deal stage)
- SMS notifications
- Invite management dashboard (list/revoke/resend invites)
