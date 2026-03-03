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
  tokenHash       String    @unique                // SHA-256 of raw token; raw token NEVER stored
  dealId          String                           // HubSpot deal ID
  customerEmail   String
  customerName    String
  customerPhone   String?
  propertyAddress String                           // survey site address
  pbLocation      String                           // Westminster, Centennial, etc.
  systemSize      Float?                           // kW, from deal
  status          SurveyInviteStatus @default(PENDING)
  expiresAt       DateTime                         // token TTL (default 14 days)
  scheduledAt     DateTime?                        // UTC — when customer booked
  scheduledDate   String?                          // YYYY-MM-DD (location-local date)
  scheduledTime   String?                          // HH:MM (location-local time)
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
  @@index([status, expiresAt])
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

**Constraints:**
- `tokenHash` is unique (covers lookup + uniqueness)
- Composite index on `(status, expiresAt)` for expiry sweeps
- One active invite per deal enforced at app level: reject `POST /invite` if an active (PENDING | SCHEDULED) invite already exists for that `dealId`

---

## 2. Token Design

- **Generation:** 32 bytes via `crypto.randomBytes(32)`, base64url-encoded → 43-char URL-safe string
- **Storage:** Only `SHA-256(token)` stored in `tokenHash` column. Raw token exists only in the invite URL and never hits the DB
- **Lookup:** On portal request, hash the incoming token and query by `tokenHash`
- **Expiry:** 14-day default, checked at query time
- **Revocation:** Setting status to `CANCELLED` or `EXPIRED` invalidates the token without needing to touch the hash

---

## 3. Timezone Handling

- All `DateTime` fields stored as UTC
- `scheduledDate` / `scheduledTime` stored as location-local strings (e.g. `2026-03-15` / `09:00` in America/Denver for Westminster)
- Each `pbLocation` maps to an IANA timezone (already exists in crew availability system)
- Portal UI renders times in the location's timezone with the timezone label shown to the customer
- Availability computation uses location timezone for day boundaries

---

## 4. New Files & Routes

### Public Portal Pages (no auth required)
```
src/app/portal/survey/[token]/page.tsx              # Scheduling UI
src/app/portal/survey/[token]/layout.tsx            # Minimal layout (PB logo, no sidebar)
src/app/portal/survey/[token]/confirmation/page.tsx # Post-booking confirmation
```

### Public API Routes (token-validated, no next-auth)
```
src/app/api/portal/survey/[token]/route.ts             # GET: invite details + available slots
src/app/api/portal/survey/[token]/book/route.ts        # POST: book a slot
src/app/api/portal/survey/[token]/reschedule/route.ts  # PUT: change booking
src/app/api/portal/survey/[token]/cancel/route.ts      # POST: cancel booking
```

### Internal API Routes (auth required)
```
src/app/api/portal/survey/invite/route.ts    # POST: create invite + send email
src/app/api/portal/survey/invites/route.ts   # GET: list invites (for dashboard)
```

### Shared Utilities
```
src/lib/portal-token.ts          # Token generation, hashing, validation
src/lib/portal-availability.ts   # Compute available slots for customer view
```

### Email Templates
```
src/emails/SurveyInviteEmail.tsx       # "Schedule your site survey" CTA email
src/emails/SurveyConfirmationEmail.tsx # Booking confirmation + .ics attachment
```

---

## 5. Implementation Steps

### Step 1: Schema + Token Infrastructure
- Add `SurveyInvite` model + `SurveyInviteStatus` enum to Prisma schema
- Run `prisma generate` / `prisma db push`
- Create `src/lib/portal-token.ts`:
  - `generateToken()` → `{ raw: string, hash: string }` (32-byte random, base64url + SHA-256)
  - `hashToken(raw)` → SHA-256 hex digest
  - `validateToken(raw)` → fetch invite by hash, check expiry + status, return invite or null

### Step 2: Availability Computation for Portal
- Create `src/lib/portal-availability.ts`:
  - Reuse existing `CrewAvailability` + `BookedSlot` + `AvailabilityOverride` queries
  - Compute available survey slots for a `pbLocation` over the next 14 days
  - Return slots grouped by date: `{ date: string, slots: { time: string, slotId: string }[] }`
  - `slotId` is an opaque identifier (e.g. HMAC of date+time+crewId) — no internal IDs exposed
  - Apply business rules: no same-day booking, configurable minimum lead time
  - All time math uses location timezone for day boundaries

### Step 3: Public API Endpoints

**GET `/api/portal/survey/[token]`**
- Hash token, lookup invite by `tokenHash`
- Validate: exists, not expired, status is PENDING or SCHEDULED
- Return: customer name, property address, available slots (if PENDING), current booking (if SCHEDULED)
- Rate limit: 20 req/min per token, 60 req/min per IP
- Expose nothing internal: no crew names, deal IDs, or internal statuses

**POST `/api/portal/survey/[token]/book`**
- Body: `{ slotId: string, accessNotes?: string, idempotencyKey: string }`
- Idempotency: if `idempotencyKey` matches a previous successful booking for this invite, return the existing booking (prevents double-submit)
- Validate: token valid, status is PENDING, slot still available
- **DB transaction:** re-check slot availability + create `BookedSlot` + update `SurveyInvite` status → SCHEDULED atomically
- **Async outbox:** after commit, enqueue Zuper job creation + confirmation email + internal notification
  - If Zuper fails: invite stays SCHEDULED, `zuperJobUid` stays null, ops notified to manually sync
  - If email fails: logged to Sentry, ops notified, customer can still see confirmation in portal
- Log activity: `SURVEY_SCHEDULED`, source `customer_portal`

**PUT `/api/portal/survey/[token]/reschedule`**
- Body: `{ slotId: string, idempotencyKey: string }`
- Only if status is SCHEDULED and survey date is >24h away
- DB transaction: free old slot + book new slot + update invite
- Async: update Zuper job schedule + send updated confirmation + internal notification

**POST `/api/portal/survey/[token]/cancel`**
- Body: `{ idempotencyKey: string }`
- Only if status is SCHEDULED and survey date is >24h away
- DB transaction: free slot + update status → CANCELLED
- Async: update Zuper job status + send cancellation emails

### Step 4: Customer-Facing UI

**Layout** (`portal/survey/[token]/layout.tsx`):
- Minimal: PB logo, no sidebar/nav, no auth checks
- Responsive, mobile-first (customers will mostly use phones)
- Theme tokens for consistency, simpler than internal dashboards

**Main Page** (`portal/survey/[token]/page.tsx`):
- Fetch invite + slots on load via GET endpoint
- Greeting with customer name, property address, brief instructions
- Calendar date picker (next 14 days, disabled dates with no availability)
- Time slot grid for selected date (location timezone displayed)
- Access notes textarea ("Gate codes, pets, parking instructions...")
- Confirm button with loading state (idempotencyKey generated client-side on mount)
- On success → redirect to confirmation page
- States: loading, invalid/expired token, already scheduled (show current booking), no availability, error

**Confirmation Page** (`portal/survey/[token]/confirmation`):
- Date, time (with timezone), address, what to expect
- "Add to Calendar" link (Google Calendar URL + .ics download)
- Reschedule / Cancel buttons (visible only if >24h before survey)
- Contact info for questions

### Step 5: Internal Invite API + Email

**POST `/api/portal/survey/invite`** (requires auth + `canScheduleSurveys`):
- Body: `{ dealId, customerEmail, customerName, propertyAddress, pbLocation, systemSize?, customerPhone? }`
- Reject if an active invite (PENDING | SCHEDULED) already exists for `dealId`
- Generate token → store `tokenHash`, build portal URL with raw token
- Create `SurveyInvite` (status: PENDING, expiresAt: now + 14 days)
- Send invite email via Resend
- Log activity

**SurveyInviteEmail:**
- Subject: "Schedule Your Site Survey — Photon Brothers"
- Greeting, brief explanation of what a site survey is, CTA button linking to portal URL
- Mobile-friendly, branded

**SurveyConfirmationEmail:**
- Subject: "Your Site Survey is Confirmed"
- Date/time, address, what to expect, reschedule/cancel links back to portal
- .ics calendar attachment

### Step 6: Middleware + Auth Bypass
- Add `/portal` to `ALWAYS_ALLOWED` array in `src/middleware.ts` so portal routes skip auth checks
- Portal routes validate access via token hash lookup instead

### Step 7: Integration with Existing Scheduler
- Add "Send Portal Invite" button to site survey scheduler dashboard
  - On project row or detail panel
  - Pre-fills customer info from HubSpot deal data
  - Shows invite status badge if one already exists for that deal (PENDING/SCHEDULED/etc.)
- Add `source: "customer_portal"` tracking to `ScheduleRecord` for analytics

---

## 6. Security

| Concern | Approach |
|---------|----------|
| Token secrecy | SHA-256 hash at rest; raw token only in URL |
| Token entropy | 32 bytes (256-bit), base64url, 43 chars |
| Expiry | 14-day default, checked at query time |
| Rate limiting | Per-token (20/min) + per-IP (60/min) on public endpoints |
| Input validation | Zod schemas on all API request bodies |
| Data exposure | No crew names, deal IDs, or internal statuses in portal responses |
| Race conditions | Slot availability re-checked inside DB transaction at booking time |
| Double-submit | Client-generated `idempotencyKey` on book/reschedule/cancel |
| Partial failure | DB commit first (booking is source of truth), Zuper + email async with retry |
| One invite per deal | Partial unique index on `(dealId) WHERE status IN ('PENDING','SCHEDULED')` + app-level guard |
| Idempotency | `IdempotencyKey` table in Postgres (transactional), scoped per action+token, 24h TTL |
| Async reliability | Outbox table written in same transaction as booking; cron + `after()` processor with backoff and dead-letter |
| Slot locking | `SELECT ... FOR UPDATE` on crew availability row inside booking transaction |
| Rate limit state | Upstash Redis for cross-instance shared counters (edge-compatible) |
| 24h cutoff | Pre-computed `cutoffAt` UTC timestamp stored on invite; DST-safe derivation at booking time |
| Audit trail | All portal actions logged to `ActivityLog` with `source: "customer_portal"` |

---

## 7. Existing Files Modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `SurveyInvite`, `IdempotencyKey`, `OutboxEvent` models + `SurveyInviteStatus` enum |
| `src/middleware.ts` | Add `/portal` to `ALWAYS_ALLOWED` for auth bypass |
| `src/app/dashboards/site-survey-scheduler/page.tsx` | Add "Send Invite" button per project |
| `src/lib/email.ts` | Add portal email sending functions |

---

## 8. Test Coverage

| Scenario | Type |
|----------|------|
| Token generation + hash round-trip | Unit |
| Expired token rejected | Unit |
| Cancelled/completed invite rejected | Unit |
| Slot availability computation respects overrides + booked slots | Unit |
| Booking race condition: two concurrent bookings for last slot, one wins | Integration |
| Idempotent re-submit returns same booking | Integration |
| 24h cutoff enforced for reschedule/cancel | Unit |
| One active invite per deal constraint | Integration |
| Rate limiting triggers on excess requests | Integration |
| Zuper failure doesn't roll back booking | Integration |
| Email failure doesn't roll back booking | Integration |
| Timezone boundary edge cases (late-night bookings, DST transitions) | Unit |

---

## 9. Implementation Checklist (Pre-Coding)

Risks that must be resolved in code, not deferred:

### P1 — Must resolve before shipping

**[P1-1] Partial unique index for one-active-invite-per-deal**
App-level checks race under concurrent requests. Use a Postgres partial unique index via raw SQL migration:
```sql
CREATE UNIQUE INDEX uq_active_invite_per_deal
  ON "SurveyInvite" ("dealId")
  WHERE status IN ('PENDING', 'SCHEDULED');
```
This makes the DB reject a second active invite for the same deal even if two requests slip through the app check simultaneously. Keep the app-level check as a fast-path guard with a user-friendly error message.

**[P1-2] Idempotency key storage and semantics**
- Store in an `IdempotencyKey` table in Postgres (not Redis — keeps it transactional with the booking):
  ```prisma
  model IdempotencyKey {
    key       String   @id          // client-generated UUID
    scope     String                // "book:{tokenHash}" | "reschedule:{tokenHash}" | "cancel:{tokenHash}"
    status    String                // "processing" | "completed" | "failed"
    response  Json?                 // cached response payload for replay
    createdAt DateTime @default(now())
    expiresAt DateTime              // TTL: 24 hours
    @@unique([key, scope])
  }
  ```
- On request: check if `(key, scope)` exists.
  - `completed` → replay cached response (HTTP 200, same body)
  - `processing` → return HTTP 409 Conflict (concurrent in-flight)
  - `failed` → allow retry (delete old row, reprocess)
  - Not found → insert with `processing`, proceed, update to `completed` with response on success
- TTL: 24 hours, swept by a cron or on-read expiry check
- Scope is `action:tokenHash` so the same idempotency key can't cross actions

**[P1-3] Outbox pattern for Zuper + email (not fire-and-forget)**
- Add an `OutboxEvent` table:
  ```prisma
  model OutboxEvent {
    id          String   @id @default(cuid())
    type        String                // "zuper_create_job" | "send_confirmation_email" | "send_internal_notification"
    payload     Json                  // serialized args for the handler
    status      String   @default("pending")  // "pending" | "processing" | "completed" | "failed" | "dead_letter"
    attempts    Int      @default(0)
    maxAttempts Int      @default(5)
    lastError   String?
    nextRetryAt DateTime?             // exponential backoff: 30s, 2m, 8m, 32m, 2h
    inviteId    String                // FK to SurveyInvite
    createdAt   DateTime @default(now())
    processedAt DateTime?
    @@index([status, nextRetryAt])
  }
  ```
- Write outbox rows in the same DB transaction as the booking commit
- Process via: (a) Vercel cron job polling every 30s, or (b) `after()` (Next.js post-response callback) for immediate attempt + cron as fallback
- Retry with exponential backoff: 30s → 2m → 8m → 32m → 2h
- After `maxAttempts`: mark `dead_letter`, alert ops via existing notification channel
- Reconciliation: daily cron checks for SCHEDULED invites with null `zuperJobUid` and re-queues

### P2 — Must resolve, can finalize during implementation

**[P2-1] Booking race condition: row-level locking**
Inside the booking DB transaction:
1. `SELECT ... FOR UPDATE` on relevant `CrewAvailability` row for the selected slot
2. Check `BookedSlot` count for that crew member + date + time doesn't exceed capacity
3. Insert `BookedSlot` — if a unique constraint fires (crew + date + time), catch and return 409
This guarantees a single winner even under concurrent bookings. The `FOR UPDATE` lock serializes competing transactions on the same slot.

**[P2-2] Rate limiting backend**
Use Vercel's built-in `@vercel/edge` rate limiting or Upstash Redis (`@upstash/ratelimit`) for shared-state limits across instances:
- Per-token: sliding window, 20 req/min
- Per-IP: sliding window, 60 req/min
- Returns `429 Too Many Requests` with `Retry-After` header
Decision: Upstash Redis (already compatible with edge runtime, sub-ms latency). If no Redis is available, fall back to in-memory with a TODO to upgrade before scaling beyond one instance.

**[P2-3] 24-hour cutoff definition (DST-safe)**
- Cutoff = `scheduledStartUTC - 24 hours`, computed once at booking time and stored as `cutoffAt DateTime` on the invite
- `scheduledStartUTC` derived from `scheduledDate` + `scheduledTime` + location IANA timezone using a DST-safe library (e.g., `date-fns-tz` or `Temporal` if available)
- Reschedule/cancel endpoints compare `now() < cutoffAt` — no timezone math at request time
- Edge case: if DST spring-forward makes a 2:30 AM slot non-existent, slot computation should already exclude it

---

## 10. Out of Scope (Future Phases)

- Customer accounts / login system
- Project status tracker
- Document upload / viewing
- In-portal messaging
- Multi-survey booking
- HubSpot workflow automation (auto-send invites at deal stage)
- SMS notifications
- Invite management dashboard (list/revoke/resend invites)
