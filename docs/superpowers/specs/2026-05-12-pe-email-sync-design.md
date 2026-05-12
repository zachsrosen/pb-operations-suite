# PE Email Sync — Design Spec

**Date**: 2026-05-12
**Status**: Draft
**Author**: Claude + Zach

## Problem

Participate Energy sends structured notification emails to `tpo@photonbrothers.com` whenever a document status changes (approved, rejected, under review). Currently, the only way to update `PeDocumentReview` statuses is by scraping the entire PE portal or importing a CSV — both manual, infrequent operations. This creates a lag between PE reviewing a document and PB Ops reflecting the updated status.

## Solution

Parse incoming PE notification emails via the Gmail API (service account with domain-wide delegation on `tpo@photonbrothers.com`) and upsert document statuses into `PeDocumentReview`. Runs on a 30-minute cron with an optional manual trigger from the pe-docs dashboard.

This is an incremental complement to the full portal scrape — emails provide near-real-time deltas while the scrape provides periodic full snapshots.

## Email Format

Every PE notification email follows this consistent format:

**Subject**: `{Customer Name} - {Document Type}`
- Examples: `David Rose - Photos`, `Benjamin Randolph - Certificate of Acceptance`
- Edge case: sometimes `{Name}- {DocType}` (no space before dash)

**From**: `Participate.Energy` / `noreply@participate.energy`

**Body** (plaintext):
```
Hi {Greeting},

We have updated the status of the submitted {Document Type}[ for your reference]:

Reviewer - {Reviewer Name}
{Document Type} Status - {Status}
Partner Comments - {text or empty}
Approver Comments - {text or empty}
```

- Greeting varies: "Photon Brothers Inc", "Layla", "Kaitlyn", etc. (irrelevant for parsing)
- "for your reference" suffix appears on some doc types (e.g., Photos), not others

## Components

### 1. Email Body Fetcher — `fetchSharedInboxMessages()`

**File**: `src/lib/gmail-shared-inbox.ts` (new export)

The existing `fetchSharedInboxThreads()` only returns metadata (subject, from, date, snippet). The email sync needs full plaintext bodies. New function:

```typescript
export interface SharedInboxMessage {
  id: string;           // Gmail message ID
  threadId: string;
  subject: string;
  from: string;
  date: string;         // ISO 8601
  plainTextBody: string; // decoded from base64url
}

export interface FetchMessagesResult {
  ok: true; messages: SharedInboxMessage[];
} | {
  ok: false; error: string;
}

export async function fetchSharedInboxMessages(opts: {
  mailbox: string;
  query: string;
  maxMessages?: number; // default 100
}): Promise<FetchMessagesResult>
```

**Implementation**:
1. `GET /gmail/v1/users/{mailbox}/messages?q={query}&maxResults={max}` — list message IDs
2. For each message: `GET /gmail/v1/users/{mailbox}/messages/{id}?format=full`
3. Extract plaintext body:
   - If `payload.mimeType` is `text/plain`, decode `payload.body.data` from base64url
   - If multipart, walk `payload.parts[]` for the `text/plain` part
4. Extract subject, from, date from `payload.headers[]`
5. Return `{ ok: true, messages }` sorted oldest-first (chronological order for safe upsert)

**Error handling**: Auth failures and API errors return `{ ok: false, error: "..." }` instead of silently returning empty. This lets the cron distinguish "no new emails" from "Gmail unreachable" in its response.

**Auth**: Same service account impersonation path already used for permit/IC inboxes. Scope `gmail.readonly` is sufficient.

**Rate handling**: Sequential fetches. Gmail API quota (250 units/sec) is generous for our volume (~50 emails/day max).

### 2. Email Parser — `parsePeNotificationEmail()`

**File**: `src/lib/pe-email-sync.ts` (new file)

```typescript
export interface PeEmailUpdate {
  customerName: string;
  docType: string;         // canonical 15-doc name
  status: PeDocStatus;
  reviewer: string | null;
  partnerComments: string | null;
  approverComments: string | null;
  emailDate: Date;
  messageId: string;
}

export function parsePeNotificationEmail(
  msg: SharedInboxMessage
): PeEmailUpdate | null
```

**Subject parsing**:
- Split on the LAST occurrence of ` - ` (space-dash-space). If no match, split on the LAST occurrence of `- ` (dash-space, for the "Randolph-" variant).
- Everything before the last separator = `customerName` (trimmed)
- Everything after = raw doc type

**Doc type mapping** — `EMAIL_DOC_NAME_MAP`:

| Email Subject Term | Canonical DB Name |
|---|---|
| `Photos` | `Photos per Policy` |
| `Photo` | `Photos per Policy` |
| `Proposal` | `Signed Proposal` |
| `PTO` | `Permission to Operate (PTO)` |
| `Customer Agreement` | `Customer Agreement (PPA/ESA)` |
| `Lien Waiver` | `Conditional Progress Lien Waiver` |
| `Conditional Waiver` | `Conditional Waiver — Final Payment` |
| `Interconnection Agreement` | `Signed Interconnection Agreement` |
| `Attestation` | `Attestation of Customer Payment` |
| `Final Permit` | `Signed Final Permit` |
| `Monitoring` | `Access to Monitoring` |

**Passthrough doc types** — these email subject terms match canonical names directly via the existing `DOC_NAME_MAP` (case-insensitive) and need no special mapping:
- `Certificate of Acceptance` -> `Certificate of Acceptance`
- `Design Plan` -> `Design Plan`
- `Utility Bill` -> `Utility Bill`
- `State Disclosures` -> `State Disclosures`
- `Installation Order` -> `Installation Order`
- `Signed Final Permit` -> `Signed Final Permit`
- `Access to Monitoring` -> `Access to Monitoring`
- `Signed Proposal` -> `Signed Proposal`

**Resolution order**: Check `EMAIL_DOC_NAME_MAP` first (exact match), then fall through to `normalizeDocName()` (exported from `pe-scraper-sync.ts` — currently unexported, needs to be exported as part of this work). If no match, return `null` (skip with warning log).

**Body parsing** (regex per line):
- Reviewer: `/Reviewer\s*-\s*(.+)/i` -> trim
- Status: `/{docType}\s*Status\s*-\s*(.+)/i` -> trim, map via `EMAIL_STATUS_MAP`
- Partner Comments: `/Partner\s*Comments\s*-\s*(.*)/i` -> trim, empty string -> null
- Approver Comments: `/Approver\s*Comments\s*-\s*(.*)/i` -> trim, empty string -> null

**Status mapping** — `EMAIL_STATUS_MAP`:

| Email Status | `PeDocStatus` |
|---|---|
| `Approved` | `APPROVED` |
| `Response Needed` | `ACTION_REQUIRED` |
| `Under Review` | `UNDER_REVIEW` |
| `Uploaded` | `UPLOADED` |
| `Document Uploaded` | `UPLOADED` |
| `Not Uploaded` | `NOT_UPLOADED` |

Case-insensitive matching with trim. If no match, return `null` (skip with warning).

Note: `REJECTED` is in the `PeDocStatus` enum but PE emails use "Response Needed" for rejections, not "Rejected". If PE ever introduces a literal "Rejected" status in emails, add it to this map at that time.

### 3. Sync Orchestrator — `syncPeEmailStatuses()`

**File**: `src/lib/pe-email-sync.ts`

```typescript
export interface PeEmailSyncResult {
  emailsFetched: number;
  parsed: number;
  matched: number;
  unmatched: string[];   // customer names that couldn't match a deal
  upserted: number;
  errors: number;
  skipped: number;       // emails older than existing reviewedAt
  newWatermark: string;  // ISO date of newest processed email
  gmailError?: string;   // set if Gmail API was unreachable
}

export async function syncPeEmailStatuses(opts?: {
  sinceDate?: string;    // override high-water mark (ISO date)
  dryRun?: boolean;
}): Promise<PeEmailSyncResult>
```

**Flow**:
1. Read high-water mark from `SystemConfig` key `pe-email-sync:lastProcessedDate`. Default: 7 days ago if not set.
2. Convert watermark to Gmail `after:` query format (`YYYY/MM/DD`). Query Gmail: `from:{PE_NOTIFICATION_SENDER} after:{date}` via `fetchSharedInboxMessages({ mailbox: PE_TPO_MAILBOX, query, maxMessages: 200 })`.
3. If `fetchSharedInboxMessages` returns `{ ok: false }`, return early with `gmailError` set and all counts at 0. Do NOT advance watermark.
4. Messages arrive sorted oldest-first (chronological). Parse each via `parsePeNotificationEmail()`. Skip nulls (unparseable).
5. Build deal map via `buildPeDealMap()` (single call, reused for all emails).
6. For each parsed update, match `customerName` to a deal ID using `matchProjectToDeal()`. Wrap the email customer name as `{ customerName, projNumber: '', stage: '' }` since the function guards `projNumber` usage with `if (project.projNumber)`. (Do NOT use `matchCsvProjectToDeal` — it has a latent bug where it doesn't filter `pe:` prefixed keys from the deal map.)
7. **Temporal dedup**: For each `(dealId, docName)` pair, check the existing `PeDocumentReview` row's `reviewedAt`. If the email's date is older than `reviewedAt`, skip it (prevents status regression from re-processing older emails). This is the primary dedup mechanism — it ensures that only newer status changes overwrite older ones, regardless of how many times the cron re-processes the same email window.
8. Batch upsert via `prisma.peDocumentReview.upsert()` in groups of 50 using `Promise.allSettled()`:
   - `where: { dealId_docName: { dealId, docName } }`
   - `update: { status, notes: comments, reviewedAt: emailDate, reviewedBy: "pe-email-sync:{messageId}" }`
   - `create: { dealId, docName, status, notes: comments, reviewedAt: emailDate, reviewedBy: "pe-email-sync:{messageId}" }`
9. Update `SystemConfig` watermark to the newest email date processed (only on success).
10. Return summary.

**Notes field**: Concatenates partner + approver comments: `"Partner: {x} | Approver: {y}"` (omitting empty sections).

**Env vars** (with defaults):
- `PE_NOTIFICATION_SENDER` — default `noreply@participate.energy`
- `PE_TPO_MAILBOX` — default `tpo@photonbrothers.com`

### 4. Cron Endpoint

**File**: `src/app/api/cron/pe-email-sync/route.ts`

```typescript
export const maxDuration = 120;

export async function POST(req: Request) {
  // Verify cron secret (same pattern as other cron endpoints)
  // Call syncPeEmailStatuses()
  // Log summary via ActivityLog (type: PE_EMAIL_SYNC)
  // Return JSON summary — includes gmailError if Gmail was unreachable
}
```

**Vercel cron config** (in `vercel.json`):
```json
{ "path": "/api/cron/pe-email-sync", "schedule": "*/30 * * * *" }
```

**Function config** (in `vercel.json`):
```json
"src/app/api/cron/pe-email-sync/route.ts": { "maxDuration": 120 }
```

**Role access**: Add `/api/cron/pe-email-sync` to the public/cron routes list in middleware (same as existing cron endpoints — verified by `CRON_SECRET` header, not session).

### 5. Manual Trigger Integration

**File**: `src/app/api/accounting/pe-docs/sync/route.ts` (modify existing)

Add new input format to the POST handler:
```typescript
if (body.source === "email") {
  const result = await syncPeEmailStatuses({
    sinceDate: body.sinceDate, // optional override
  });
  return NextResponse.json(result);
}
```

**Dashboard button**: Add "Sync from Email" button on the pe-docs dashboard page alongside the existing sync controls. Calls `POST /api/accounting/pe-docs/sync` with `{ source: "email" }`.

### 6. Role Access

The cron endpoint is protected by `CRON_SECRET` (no session needed). The manual trigger goes through the existing `/api/accounting/pe-docs/sync` endpoint which already has role restrictions: `ADMIN`, `EXECUTIVE`, `ACCOUNTING`, `OWNER`.

No new route allowlist entries needed in `roles.ts` — the cron path falls under the existing cron exemption in middleware, and the manual trigger reuses the existing sync endpoint.

## New Files

| File | Purpose |
|---|---|
| `src/lib/pe-email-sync.ts` | Parser + orchestrator (new) |
| `src/app/api/cron/pe-email-sync/route.ts` | Cron endpoint (new) |

## Modified Files

| File | Change |
|---|---|
| `src/lib/gmail-shared-inbox.ts` | Add `fetchSharedInboxMessages()` for full body fetching |
| `src/lib/pe-scraper-sync.ts` | Export `normalizeDocName()` and `DOC_NAME_MAP` |
| `src/app/api/accounting/pe-docs/sync/route.ts` | Add `source: "email"` input path |
| `src/app/dashboards/pe-docs/page.tsx` | Add "Sync from Email" button |
| `src/middleware.ts` | Add `/api/cron/pe-email-sync` to public cron routes |
| `vercel.json` | Add cron schedule + function config for pe-email-sync |
| `prisma/schema.prisma` | Add `PE_EMAIL_SYNC` to `ActivityType` enum |

## Schema Changes

One additive enum migration:

```prisma
// Add to ActivityType enum
PE_EMAIL_SYNC
```

This is a safe additive migration (no column changes, no data migration).

## Edge Cases

1. **Name mismatches**: Some PE customer names don't match HubSpot deal names (middle names, suffixes, spelling). These are logged in `unmatched[]` and skipped — the full portal scrape (which uses PE project IDs) catches these.
2. **Duplicate emails**: PE sometimes sends the same notification twice (thread with 2 messages). Temporal dedup prevents double-processing: if email date <= existing `reviewedAt`, it's skipped.
3. **Status regression**: Emails are processed oldest-first. The temporal dedup (step 7) ensures older emails never overwrite newer statuses. If the `sinceDate` override re-processes a wider window, the `emailDate > reviewedAt` check still protects against regression.
4. **Gmail API downtime**: `fetchSharedInboxMessages` returns `{ ok: false, error }`. The cron reports the error in its response, does not advance the watermark, and tries again in 30 min.
5. **Subject parsing ambiguity**: Names containing " - " (rare). Both the primary split (` - `) and fallback split (`- `) use the LAST occurrence to handle names like "Mary-Jane Watson - Photos".
6. **PE sender address changes**: Parameterized via `PE_NOTIFICATION_SENDER` env var (default `noreply@participate.energy`). Mailbox address parameterized via `PE_TPO_MAILBOX` (default `tpo@photonbrothers.com`).

## Out of Scope

- Gmail push notifications (Pub/Sub) — overkill for 30-min polling
- Auto-labeling emails after processing (would need `gmail.modify` scope)
- Parsing PE Status Report emails (different format, handled separately)
- Updating HubSpot `pe_m1_status`/`pe_m2_status` from email data (that's the existing pe-invoice-audit cron's job based on aggregated doc statuses)
