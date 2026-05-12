# PE Email Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse Participate Energy notification emails from tpo@photonbrothers.com and upsert document statuses into `PeDocumentReview`, running on a 30-min cron with a manual trigger option.

**Architecture:** New `pe-email-sync.ts` lib handles email parsing + orchestration, reusing the existing `buildPeDealMap()` and `matchProjectToDeal()` from `pe-scraper-sync.ts`. A new `fetchSharedInboxMessages()` in `gmail-shared-inbox.ts` fetches full message bodies via the existing service account DWD auth. A cron endpoint triggers every 30 min; a manual trigger reuses the existing `/api/accounting/pe-docs/sync` endpoint.

**Tech Stack:** Next.js API routes, Gmail API (REST), Prisma, Vercel cron

**Spec:** `docs/superpowers/specs/2026-05-12-pe-email-sync-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/gmail-shared-inbox.ts` | Modify | Add `fetchSharedInboxMessages()` for full message body fetching |
| `src/lib/pe-scraper-sync.ts` | Modify | Export `normalizeDocName()` and `DOC_NAME_MAP` |
| `src/lib/pe-email-sync.ts` | Create | Email parser + sync orchestrator |
| `src/app/api/cron/pe-email-sync/route.ts` | Create | Cron endpoint |
| `src/app/api/accounting/pe-docs/sync/route.ts` | Modify | Add `source: "email"` input path |
| `src/app/dashboards/pe-docs/page.tsx` | Modify | Add "Sync from Email" button |
| `src/middleware.ts` | Modify | Add cron route to public routes |
| `vercel.json` | Modify | Add cron schedule + function config |
| `prisma/schema.prisma` | Modify | Add `PE_EMAIL_SYNC` to `ActivityType` enum |
| `src/__tests__/pe-email-sync.test.ts` | Create | Unit tests for parser + orchestrator |

---

## Chunk 1: Gmail Message Fetcher + Exports

### Task 1: Export `normalizeDocName` and `DOC_NAME_MAP` from pe-scraper-sync.ts

**Files:**
- Modify: `src/lib/pe-scraper-sync.ts:224-248`

- [ ] **Step 1: Change `const DOC_NAME_MAP` to `export const DOC_NAME_MAP`**

In `src/lib/pe-scraper-sync.ts` line 224, change:
```typescript
const DOC_NAME_MAP: Record<string, string> = {
```
to:
```typescript
export const DOC_NAME_MAP: Record<string, string> = {
```

- [ ] **Step 2: Change `function normalizeDocName` to `export function normalizeDocName`**

In `src/lib/pe-scraper-sync.ts` line 245, change:
```typescript
function normalizeDocName(raw: string): string {
```
to:
```typescript
export function normalizeDocName(raw: string): string {
```

- [ ] **Step 3: Verify no build errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (these were already used internally, just not exported)

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-scraper-sync.ts
git commit -m "feat(pe): export normalizeDocName and DOC_NAME_MAP for email sync"
```

---

### Task 2: Add `fetchSharedInboxMessages()` to gmail-shared-inbox.ts

**Files:**
- Modify: `src/lib/gmail-shared-inbox.ts` (add after line 402, end of file)

- [ ] **Step 1: Write the test for fetchSharedInboxMessages**

Create `src/__tests__/pe-email-sync.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";

// We'll test the parsing logic directly in later tasks.
// For fetchSharedInboxMessages, we verify the base64url decoding helper.

describe("base64url decoding", () => {
  it("decodes a base64url-encoded plaintext body", () => {
    // "Hello, World!" in base64url
    const encoded = "SGVsbG8sIFdvcmxkIQ";
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8");
    expect(decoded).toBe("Hello, World!");
  });

  it("handles padding-less base64url", () => {
    // "Hi Photon Brothers Inc," in base64url (no padding)
    const text = "Hi Photon Brothers Inc,";
    const encoded = Buffer.from(text).toString("base64url");
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8");
    expect(decoded).toBe(text);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these are unit tests for Node built-in, should pass)

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1 | tail -20`

- [ ] **Step 3: Add SharedInboxMessage interface and FetchMessagesResult type**

In `src/lib/gmail-shared-inbox.ts`, add after the `SharedInboxThread` interface (after line 44):

```typescript
export interface SharedInboxMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  plainTextBody: string;
}

export type FetchMessagesResult =
  | { ok: true; messages: SharedInboxMessage[] }
  | { ok: false; error: string };
```

- [ ] **Step 4: Add `fetchSharedInboxMessages` function**

Append to end of `src/lib/gmail-shared-inbox.ts`:

```typescript
/**
 * Fetch full message bodies from a shared inbox.
 * Unlike fetchSharedInboxThreads (metadata only), this returns plaintext bodies.
 * Returns a discriminated result so callers can distinguish "no emails" from "API error".
 */
export async function fetchSharedInboxMessages(opts: {
  mailbox: string;
  query: string;
  maxMessages?: number;
}): Promise<FetchMessagesResult> {
  const max = opts.maxMessages ?? 100;
  const label = `fetchSharedInboxMessages(${opts.mailbox})`;

  let accessToken: string | null = null;
  try {
    const stored = await import("@/lib/shared-inbox-token").then((m) =>
      m.getStoredSharedInboxToken(opts.mailbox),
    );
    if (stored) {
      accessToken = stored;
    }
  } catch {
    /* fall through to service account */
  }

  if (!accessToken) {
    const tokenResult = await getReadonlyTokenVerbose(opts.mailbox);
    if (!tokenResult.ok) {
      console.error(`[${label}] Auth failed:`, tokenResult.error);
      return { ok: false, error: `Auth failed: ${tokenResult.error}` };
    }
    accessToken = tokenResult.token;
  }

  // List message IDs
  const listUrl = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(opts.mailbox)}/messages`,
  );
  listUrl.searchParams.set("q", opts.query);
  listUrl.searchParams.set("maxResults", String(max));

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => "unknown");
    console.error(`[${label}] List messages failed ${listRes.status}:`, errText);
    return { ok: false, error: `Gmail list failed: ${listRes.status}` };
  }

  const listData = (await listRes.json()) as {
    messages?: { id: string; threadId: string }[];
  };

  if (!listData.messages?.length) {
    return { ok: true, messages: [] };
  }

  // Fetch each message with full body
  const messages: SharedInboxMessage[] = [];
  for (const stub of listData.messages) {
    try {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(opts.mailbox)}/messages/${stub.id}?format=full`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!msgRes.ok) continue;

      const msgData = (await msgRes.json()) as {
        id: string;
        threadId: string;
        payload: {
          mimeType: string;
          headers: { name: string; value: string }[];
          body?: { data?: string };
          parts?: { mimeType: string; body?: { data?: string } }[];
        };
      };

      const headers = msgData.payload.headers;
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

      // Extract plaintext body
      let bodyData: string | undefined;
      if (
        msgData.payload.mimeType === "text/plain" &&
        msgData.payload.body?.data
      ) {
        bodyData = msgData.payload.body.data;
      } else if (msgData.payload.parts) {
        const textPart = msgData.payload.parts.find(
          (p) => p.mimeType === "text/plain",
        );
        bodyData = textPart?.body?.data;
      }

      const plainTextBody = bodyData
        ? Buffer.from(bodyData, "base64url").toString("utf-8")
        : "";

      messages.push({
        id: msgData.id,
        threadId: msgData.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        date: getHeader("Date"),
        plainTextBody,
      });
    } catch (err) {
      console.warn(`[${label}] Failed to fetch message ${stub.id}:`, err);
    }
  }

  // Sort oldest-first (chronological) for safe temporal dedup
  messages.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return { ok: true, messages };
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/gmail-shared-inbox.ts src/__tests__/pe-email-sync.test.ts
git commit -m "feat(gmail): add fetchSharedInboxMessages for full body fetching"
```

---

## Chunk 2: Email Parser

### Task 3: Build the email parser — `parsePeNotificationEmail()`

**Files:**
- Create: `src/lib/pe-email-sync.ts`
- Modify: `src/__tests__/pe-email-sync.test.ts`

- [ ] **Step 1: Write comprehensive parser tests**

Add to `src/__tests__/pe-email-sync.test.ts`:

```typescript
import {
  parsePeNotificationEmail,
  EMAIL_DOC_NAME_MAP,
  EMAIL_STATUS_MAP,
} from "@/lib/pe-email-sync";
import type { SharedInboxMessage } from "@/lib/gmail-shared-inbox";

function makeMsg(
  subject: string,
  body: string,
  overrides?: Partial<SharedInboxMessage>,
): SharedInboxMessage {
  return {
    id: "msg-123",
    threadId: "thread-456",
    subject,
    from: "noreply@participate.energy",
    date: "Mon, 11 May 2026 15:34:00 -0700",
    plainTextBody: body,
    ...overrides,
  };
}

describe("parsePeNotificationEmail", () => {
  it("parses a Photos Approved email", () => {
    const msg = makeMsg(
      "David Rose - Photos",
      [
        "Hi Photon Brothers Inc,",
        "",
        "We have updated the status of the submitted Photos for your reference:",
        "",
        "Reviewer - Mary Ann Festin",
        "Photo Status - Approved",
        "Partner Comments - BOM uploaded for David Rose, 4134 Stone Pl. -AS",
        "Approver Comments -",
      ].join("\n"),
    );

    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("David Rose");
    expect(result!.docType).toBe("Photos per Policy");
    expect(result!.status).toBe("APPROVED");
    expect(result!.reviewer).toBe("Mary Ann Festin");
    expect(result!.partnerComments).toBe(
      "BOM uploaded for David Rose, 4134 Stone Pl. -AS",
    );
    expect(result!.approverComments).toBeNull();
    expect(result!.messageId).toBe("msg-123");
  });

  it("parses a Certificate of Acceptance Approved email", () => {
    const msg = makeMsg(
      "Benjamin Randolph- Certificate of Acceptance",
      [
        "Hi Photon Brothers Inc,",
        "",
        "We have updated the status of the submitted Certificate of Acceptance:",
        "",
        "Reviewer - Jorge Yanson",
        "Certificate of Acceptance Status - Approved",
        "Partner Comments -  Unable to locate this project in the new portal.",
        "Approver Comments - No issues found.",
      ].join("\n"),
    );

    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Benjamin Randolph");
    expect(result!.docType).toBe("Certificate of Acceptance");
    expect(result!.status).toBe("APPROVED");
    expect(result!.reviewer).toBe("Jorge Yanson");
    expect(result!.approverComments).toBe("No issues found.");
  });

  it("parses a Response Needed (rejection) email", () => {
    const msg = makeMsg(
      "Keith Dierking - Photos",
      [
        "Hi Photon Brothers Inc,",
        "",
        "We have updated the status of the submitted Photos for your reference:",
        "",
        "Reviewer - Jancis Manlunas",
        "Photo Status - Response Needed",
        "Partner Comments -",
        "Approver Comments - 4/22 Upon checking the Tesla Powerhub, the part number is wrong.",
      ].join("\n"),
    );

    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("ACTION_REQUIRED");
    expect(result!.approverComments).toBe(
      "4/22 Upon checking the Tesla Powerhub, the part number is wrong.",
    );
  });

  it("parses a Utility Bill email (Hi Layla greeting)", () => {
    const msg = makeMsg(
      "Benjamin Randolph - Utility Bill",
      [
        "Hi Layla,",
        "",
        "We have updated the status of the submitted Utility Bill:",
        "",
        "Reviewer - Jorge Yanson",
        "Utility Bill Status - Approved",
        "Partner Comments -",
        "Approver Comments - No issues found.",
      ].join("\n"),
    );

    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Benjamin Randolph");
    expect(result!.docType).toBe("Utility Bill");
    expect(result!.status).toBe("APPROVED");
  });

  it("maps Proposal to Signed Proposal", () => {
    const msg = makeMsg(
      "John Doe - Proposal",
      "Reviewer - Test\nProposal Status - Under Review\nPartner Comments -\nApprover Comments -",
    );
    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.docType).toBe("Signed Proposal");
    expect(result!.status).toBe("UNDER_REVIEW");
  });

  it("returns null for non-PE emails", () => {
    const msg = makeMsg(
      "Meeting reminder",
      "You have a meeting at 3pm.",
    );
    const result = parsePeNotificationEmail(msg);
    expect(result).toBeNull();
  });

  it("returns null for unparseable status", () => {
    const msg = makeMsg(
      "John Doe - Photos",
      "Reviewer - Test\nPhoto Status - SomeUnknownStatus\nPartner Comments -\nApprover Comments -",
    );
    const result = parsePeNotificationEmail(msg);
    expect(result).toBeNull();
  });

  it("handles subject with no space before dash", () => {
    const msg = makeMsg(
      "Randolph- Design Plan",
      "Reviewer - Test\nDesign Plan Status - Approved\nPartner Comments -\nApprover Comments -",
    );
    const result = parsePeNotificationEmail(msg);
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Randolph");
    expect(result!.docType).toBe("Design Plan");
  });
});

describe("EMAIL_DOC_NAME_MAP", () => {
  it("maps Photos to Photos per Policy", () => {
    expect(EMAIL_DOC_NAME_MAP["photos"]).toBe("Photos per Policy");
  });
  it("maps Proposal to Signed Proposal", () => {
    expect(EMAIL_DOC_NAME_MAP["proposal"]).toBe("Signed Proposal");
  });
});

describe("EMAIL_STATUS_MAP", () => {
  it("maps Response Needed to ACTION_REQUIRED", () => {
    expect(EMAIL_STATUS_MAP["response needed"]).toBe("ACTION_REQUIRED");
  });
  it("maps Approved to APPROVED", () => {
    expect(EMAIL_STATUS_MAP["approved"]).toBe("APPROVED");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** (module doesn't exist yet)

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1 | tail -10`
Expected: FAIL — "Cannot find module '@/lib/pe-email-sync'"

- [ ] **Step 3: Create `src/lib/pe-email-sync.ts` with parser and maps**

```typescript
import type { SharedInboxMessage } from "@/lib/gmail-shared-inbox";
import { DOC_NAME_MAP } from "@/lib/pe-scraper-sync";
import { PeDocStatus } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

/** The 15 canonical PE document names. Used to validate resolved doc types. */
export const CANONICAL_PE_DOC_NAMES = new Set([
  "Customer Agreement (PPA/ESA)",
  "Installation Order",
  "State Disclosures",
  "Utility Bill",
  "Signed Proposal",
  "Design Plan",
  "Photos per Policy",
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
  "Signed Interconnection Agreement",
  "Conditional Waiver — Final Payment",
  "Permission to Operate (PTO)",
]);

/** Map email subject doc types to canonical 15-doc names (lowercase keys). */
export const EMAIL_DOC_NAME_MAP: Record<string, string> = {
  photos: "Photos per Policy",
  photo: "Photos per Policy",
  proposal: "Signed Proposal",
  pto: "Permission to Operate (PTO)",
  "customer agreement": "Customer Agreement (PPA/ESA)",
  "lien waiver": "Conditional Progress Lien Waiver",
  "conditional waiver": "Conditional Waiver — Final Payment",
  "interconnection agreement": "Signed Interconnection Agreement",
  attestation: "Attestation of Customer Payment",
  "final permit": "Signed Final Permit",
  monitoring: "Access to Monitoring",
};

/** Map email status text to PeDocStatus enum (lowercase keys). */
export const EMAIL_STATUS_MAP: Record<string, PeDocStatus> = {
  approved: PeDocStatus.APPROVED,
  "response needed": PeDocStatus.ACTION_REQUIRED,
  "under review": PeDocStatus.UNDER_REVIEW,
  uploaded: PeDocStatus.UPLOADED,
  "document uploaded": PeDocStatus.UPLOADED,
  "not uploaded": PeDocStatus.NOT_UPLOADED,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeEmailUpdate {
  customerName: string;
  docType: string;
  status: PeDocStatus;
  reviewer: string | null;
  partnerComments: string | null;
  approverComments: string | null;
  emailDate: Date;
  messageId: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a single PE notification email into a structured update.
 * Returns null if the email is not a parseable PE notification.
 */
export function parsePeNotificationEmail(
  msg: SharedInboxMessage,
): PeEmailUpdate | null {
  // --- Subject parsing ---
  // Split on the LAST occurrence of " - " or "- "
  const subject = msg.subject?.trim();
  if (!subject) return null;

  let customerName: string;
  let rawDocType: string;

  const lastSpaceDash = subject.lastIndexOf(" - ");
  if (lastSpaceDash > 0) {
    customerName = subject.slice(0, lastSpaceDash).trim();
    rawDocType = subject.slice(lastSpaceDash + 3).trim();
  } else {
    const lastDash = subject.lastIndexOf("- ");
    if (lastDash > 0) {
      customerName = subject.slice(0, lastDash).trim();
      rawDocType = subject.slice(lastDash + 2).trim();
    } else {
      return null; // no separator found
    }
  }

  if (!customerName || !rawDocType) return null;

  // --- Doc type resolution ---
  // 1. Check email-specific map, 2. Check shared DOC_NAME_MAP, 3. Validate against canonical set
  const docTypeLower = rawDocType.toLowerCase().trim();
  const docType =
    EMAIL_DOC_NAME_MAP[docTypeLower] ?? DOC_NAME_MAP[docTypeLower] ?? null;

  // If neither map matched, check if the raw doc type IS a canonical name already
  const resolvedDocType = docType ?? (CANONICAL_PE_DOC_NAMES.has(rawDocType.trim()) ? rawDocType.trim() : null);

  if (!resolvedDocType) {
    console.warn(
      `[pe-email-sync] Unknown doc type "${rawDocType}" in subject: ${subject}`,
    );
    return null;
  }

  // --- Body parsing ---
  const body = msg.plainTextBody ?? "";
  const lines = body.split("\n").map((l) => l.trim());

  // Status — look for "{DocType} Status - {value}" pattern
  // The doc type in the body may differ from subject (e.g., "Photo Status" for "Photos")
  const statusRegex = /status\s*-\s*(.+)/i;
  let statusStr: string | null = null;
  for (const line of lines) {
    const m = line.match(statusRegex);
    if (m && !line.toLowerCase().startsWith("partner") && !line.toLowerCase().startsWith("approver")) {
      statusStr = m[1].trim();
      break;
    }
  }

  if (!statusStr) return null;

  const status = EMAIL_STATUS_MAP[statusStr.toLowerCase()];
  if (!status) {
    console.warn(
      `[pe-email-sync] Unknown status "${statusStr}" in email for ${customerName}`,
    );
    return null;
  }

  // Reviewer
  const reviewerMatch = body.match(/Reviewer\s*-\s*(.+)/i);
  const reviewer = reviewerMatch?.[1]?.trim() || null;

  // Comments
  const partnerMatch = body.match(/Partner\s*Comments\s*-\s*(.*)/i);
  const partnerComments = partnerMatch?.[1]?.trim() || null;

  const approverMatch = body.match(/Approver\s*Comments\s*-\s*(.*)/i);
  const approverComments = approverMatch?.[1]?.trim() || null;

  return {
    customerName,
    docType: resolvedDocType,
    status,
    reviewer,
    partnerComments: partnerComments || null,
    approverComments: approverComments || null,
    emailDate: new Date(msg.date),
    messageId: msg.id,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-email-sync.ts src/__tests__/pe-email-sync.test.ts
git commit -m "feat(pe): add PE email notification parser with tests"
```

---

## Chunk 3: Sync Orchestrator

### Task 4: Build `syncPeEmailStatuses()` orchestrator

**Files:**
- Modify: `src/lib/pe-email-sync.ts`

- [ ] **Step 1: Add the sync result interface and orchestrator function**

Add to `src/lib/pe-email-sync.ts` after the parser:

```typescript
import { prisma } from "@/lib/db";
import {
  fetchSharedInboxMessages,
} from "@/lib/gmail-shared-inbox";
import { buildPeDealMap, matchProjectToDeal } from "@/lib/pe-scraper-sync";
```

Note: `buildPeDealMap` and `matchProjectToDeal` are already exported from `pe-scraper-sync.ts`. Verify this — if `matchProjectToDeal` is not exported, export it (same pattern as Task 1).

Add the orchestrator:

```typescript
// ---------------------------------------------------------------------------
// Sync Result
// ---------------------------------------------------------------------------

export interface PeEmailSyncResult {
  emailsFetched: number;
  parsed: number;
  matched: number;
  unmatched: string[];
  upserted: number;
  errors: number;
  skipped: number;
  newWatermark: string | null;
  gmailError?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PE_NOTIFICATION_SENDER =
  process.env.PE_NOTIFICATION_SENDER ?? "noreply@participate.energy";
const PE_TPO_MAILBOX =
  process.env.PE_TPO_MAILBOX ?? "tpo@photonbrothers.com";
const WATERMARK_KEY = "pe-email-sync:lastProcessedDate";
const DEFAULT_LOOKBACK_DAYS = 7;
const UPSERT_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function syncPeEmailStatuses(opts?: {
  sinceDate?: string;
  dryRun?: boolean;
}): Promise<PeEmailSyncResult> {
  const result: PeEmailSyncResult = {
    emailsFetched: 0,
    parsed: 0,
    matched: 0,
    unmatched: [],
    upserted: 0,
    errors: 0,
    skipped: 0,
    newWatermark: null,
  };

  // 1. Read high-water mark
  let sinceDate: Date;
  if (opts?.sinceDate) {
    sinceDate = new Date(opts.sinceDate);
  } else {
    const watermark = await prisma.systemConfig.findUnique({
      where: { key: WATERMARK_KEY },
    });
    sinceDate = watermark?.value
      ? new Date(watermark.value)
      : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000);
  }

  // 2. Build Gmail query with after:YYYY/MM/DD format
  const afterDate = [
    sinceDate.getFullYear(),
    String(sinceDate.getMonth() + 1).padStart(2, "0"),
    String(sinceDate.getDate()).padStart(2, "0"),
  ].join("/");
  const query = `from:${PE_NOTIFICATION_SENDER} after:${afterDate}`;

  // 3. Fetch emails
  const fetchResult = await fetchSharedInboxMessages({
    mailbox: PE_TPO_MAILBOX,
    query,
    maxMessages: 200,
  });

  if (!fetchResult.ok) {
    return { ...result, gmailError: fetchResult.error };
  }

  result.emailsFetched = fetchResult.messages.length;
  if (result.emailsFetched === 0) return result;

  // 4. Parse emails (already sorted oldest-first by fetcher)
  const updates: PeEmailUpdate[] = [];
  for (const msg of fetchResult.messages) {
    const parsed = parsePeNotificationEmail(msg);
    if (parsed) updates.push(parsed);
  }
  result.parsed = updates.length;

  if (updates.length === 0) return result;

  // 5. Build deal map
  const dealMap = await buildPeDealMap();

  // 6. Match and upsert
  // Group by (customerName, docType) to get latest per pair
  const upsertOps: {
    dealId: string;
    docName: string;
    status: PeDocStatus;
    notes: string | null;
    reviewedAt: Date;
    reviewedBy: string;
  }[] = [];

  for (const update of updates) {
    // Match customer to deal using synthetic ParsedProject
    const dealId = matchProjectToDeal(
      {
        customerName: update.customerName,
        projNumber: "",
        stage: "",
        m1Status: null,
        m2Status: null,
        epcCost: null,
        documents: [],
      },
      dealMap,
    );

    if (!dealId) {
      if (!result.unmatched.includes(update.customerName)) {
        result.unmatched.push(update.customerName);
      }
      continue;
    }

    result.matched++;

    // Build notes from comments
    const parts: string[] = [];
    if (update.partnerComments) parts.push(`Partner: ${update.partnerComments}`);
    if (update.approverComments) parts.push(`Approver: ${update.approverComments}`);
    const notes = parts.length > 0 ? parts.join(" | ") : null;

    upsertOps.push({
      dealId,
      docName: update.docType,
      status: update.status,
      notes,
      reviewedAt: update.emailDate,
      reviewedBy: `pe-email-sync:${update.messageId}`,
    });
  }

  if (opts?.dryRun) {
    result.upserted = upsertOps.length;
    return result;
  }

  // 7. Temporal dedup + batch upsert
  for (let i = 0; i < upsertOps.length; i += UPSERT_BATCH_SIZE) {
    const batch = upsertOps.slice(i, i + UPSERT_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (op) => {
        // Check existing row for temporal dedup
        const existing = await prisma.peDocumentReview.findUnique({
          where: { dealId_docName: { dealId: op.dealId, docName: op.docName } },
          select: { reviewedAt: true },
        });

        if (existing && existing.reviewedAt >= op.reviewedAt) {
          return "skipped";
        }

        await prisma.peDocumentReview.upsert({
          where: { dealId_docName: { dealId: op.dealId, docName: op.docName } },
          update: {
            status: op.status,
            notes: op.notes,
            reviewedAt: op.reviewedAt,
            reviewedBy: op.reviewedBy,
          },
          create: {
            dealId: op.dealId,
            docName: op.docName,
            status: op.status,
            notes: op.notes,
            reviewedAt: op.reviewedAt,
            reviewedBy: op.reviewedBy,
          },
        });
        return "upserted";
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value === "upserted") result.upserted++;
      else if (r.status === "fulfilled" && r.value === "skipped") result.skipped++;
      else if (r.status === "rejected") result.errors++;
    }
  }

  // 8. Update watermark (only if at least some emails were processed successfully)
  if (result.upserted > 0 || result.skipped > 0) {
    const newestDate = updates[updates.length - 1].emailDate.toISOString();
    result.newWatermark = newestDate;

    await prisma.systemConfig.upsert({
      where: { key: WATERMARK_KEY },
      update: { value: newestDate },
      create: { key: WATERMARK_KEY, value: newestDate },
    });
  }

  return result;
}
```

- [ ] **Step 2: Fix imports at top of file**

Make sure the top of `src/lib/pe-email-sync.ts` has all imports:

```typescript
import type { SharedInboxMessage } from "@/lib/gmail-shared-inbox";
import { fetchSharedInboxMessages } from "@/lib/gmail-shared-inbox";
import {
  DOC_NAME_MAP,
  buildPeDealMap,
  matchProjectToDeal,
} from "@/lib/pe-scraper-sync";
import { PeDocStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
```

Note: Check that `buildPeDealMap` and `matchProjectToDeal` are exported from `pe-scraper-sync.ts`. If `matchProjectToDeal` is not exported (check line 697), export it the same way we exported `normalizeDocName` in Task 1.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. If `matchProjectToDeal` or `buildPeDealMap` import fails, go export them from `pe-scraper-sync.ts`.

- [ ] **Step 4: Run existing tests to ensure nothing broke**

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1 | tail -20`
Expected: All tests still PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-email-sync.ts src/lib/pe-scraper-sync.ts
git commit -m "feat(pe): add syncPeEmailStatuses orchestrator"
```

---

## Chunk 4: Cron Endpoint + Infrastructure

### Task 5: Add `PE_EMAIL_SYNC` to ActivityType enum

**Files:**
- Modify: `prisma/schema.prisma:305-307`

- [ ] **Step 1: Add the enum value**

In `prisma/schema.prisma`, before the closing `}` of the `ActivityType` enum (line 307), add:

```prisma
  PE_EMAIL_SYNC
```

(After `AIRCALL_SYNC_RUN` on line 306.)

- [ ] **Step 2: Generate Prisma client**

Run: `npx prisma generate 2>&1 | tail -5`
Expected: "Generated Prisma Client"

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name add-pe-email-sync-activity-type --create-only 2>&1 | tail -10`
Expected: Migration file created (DO NOT run `migrate deploy` — that's an orchestrator-only action per project rules)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add PE_EMAIL_SYNC activity type"
```

---

### Task 6: Create the cron endpoint

**Files:**
- Create: `src/app/api/cron/pe-email-sync/route.ts`

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/pe-email-sync/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { syncPeEmailStatuses } from "@/lib/pe-email-sync";
import { prisma } from "@/lib/db";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncPeEmailStatuses();

    // Log to activity log
    try {
      await prisma.activityLog.create({
        data: {
          type: "PE_EMAIL_SYNC",
          description: `PE email sync: ${result.emailsFetched} fetched, ${result.parsed} parsed, ${result.matched} matched, ${result.upserted} upserted, ${result.skipped} skipped, ${result.errors} errors${result.gmailError ? `, Gmail error: ${result.gmailError}` : ""}`,
          metadata: result as unknown as Record<string, unknown>,
        },
      });
    } catch (logErr) {
      console.error("[pe-email-sync cron] Failed to log activity:", logErr);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[pe-email-sync cron] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal error", detail: String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/pe-email-sync/route.ts
git commit -m "feat(pe): add pe-email-sync cron endpoint"
```

---

### Task 7: Add cron route to middleware + vercel.json

**Files:**
- Modify: `src/middleware.ts:21-71` (PUBLIC_API_ROUTES array)
- Modify: `vercel.json:62,177`

- [ ] **Step 1: Add to middleware public routes**

In `src/middleware.ts`, find the `PUBLIC_API_ROUTES` array and add after the existing `"/api/cron/pe-invoice-audit"` entry (line 69):

```typescript
  "/api/cron/pe-email-sync",
```

- [ ] **Step 2: Add cron schedule to vercel.json**

In `vercel.json`, in the `"crons"` array (after the last entry around line 177), add:

```json
    ,{ "path": "/api/cron/pe-email-sync", "schedule": "*/30 * * * *" }
```

Also in the `"functions"` object (around line 62), add:

```json
    "src/app/api/cron/pe-email-sync/route.ts": { "maxDuration": 120 },
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts vercel.json
git commit -m "feat(pe): add pe-email-sync to middleware public routes and vercel cron"
```

---

## Chunk 5: Manual Trigger + Dashboard Button

### Task 8: Add email sync input to existing sync endpoint

**Files:**
- Modify: `src/app/api/accounting/pe-docs/sync/route.ts:40-122`

- [ ] **Step 1: Add the email source handler**

In `src/app/api/accounting/pe-docs/sync/route.ts`, in the POST handler, add an early check before the existing HTML/compact parsing logic. After the role check and body parsing, add:

```typescript
  // Email sync path
  if (body.source === "email") {
    const { syncPeEmailStatuses } = await import("@/lib/pe-email-sync");
    const result = await syncPeEmailStatuses({
      sinceDate: body.sinceDate ?? undefined,
    });
    return NextResponse.json(result);
  }
```

Place this BEFORE the existing `if (body.url)` / `if (body.html)` / `if (body.compact)` checks.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/accounting/pe-docs/sync/route.ts
git commit -m "feat(pe): add email source to PE docs sync endpoint"
```

---

### Task 9: Add "Sync from Email" button to pe-docs dashboard

**Files:**
- Modify: `src/app/dashboards/pe-docs/page.tsx`

- [ ] **Step 1: Find the existing controls area**

Look for the page header / toolbar area near the top of the component (around the `DashboardShell` or page title section). The page currently has NO sync button — add one in the header area.

- [ ] **Step 2: Add `useQueryClient` import and sync button state**

First, find the existing imports at the top of the file. Add `useQueryClient` to the `@tanstack/react-query` import (or add a new import if none exists):

```typescript
import { useQueryClient } from "@tanstack/react-query";
```

Then near the top of the component function, add:

```typescript
const queryClient = useQueryClient();
const [emailSyncing, setEmailSyncing] = useState(false);
const [syncResult, setSyncResult] = useState<{
  upserted: number;
  matched: number;
  errors: number;
  gmailError?: string;
} | null>(null);

const handleEmailSync = async () => {
  setEmailSyncing(true);
  setSyncResult(null);
  try {
    const res = await fetch("/api/accounting/pe-docs/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "email" }),
    });
    const data = await res.json();
    setSyncResult(data);
    // Refetch dashboard data after sync
    queryClient.invalidateQueries({ queryKey: ["pe-docs"] });
  } catch (err) {
    setSyncResult({ upserted: 0, matched: 0, errors: 1, gmailError: String(err) });
  } finally {
    setEmailSyncing(false);
  }
};
```

- [ ] **Step 3: Add the button to the page header**

In the header/toolbar area of the page (near the title), add:

```tsx
<button
  onClick={handleEmailSync}
  disabled={emailSyncing}
  className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
>
  {emailSyncing ? "Syncing..." : "Sync from Email"}
</button>
{syncResult && (
  <span className="text-xs text-muted">
    {syncResult.gmailError
      ? `Error: ${syncResult.gmailError}`
      : `${syncResult.upserted} updated, ${syncResult.matched} matched`}
  </span>
)}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Run all tests**

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/pe-docs/page.tsx
git commit -m "feat(pe): add Sync from Email button to pe-docs dashboard"
```

---

## Chunk 6: Final Verification

### Task 10: Full build + lint + test verification

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 2: Run ESLint**

Run: `npx eslint src/lib/pe-email-sync.ts src/app/api/cron/pe-email-sync/route.ts --fix 2>&1 | tail -10`
Expected: No errors (or auto-fixed)

- [ ] **Step 3: Run all PE-related tests**

Run: `npx jest src/__tests__/pe-email-sync.test.ts --verbose 2>&1`
Expected: All PASS

- [ ] **Step 4: Run full test suite**

Run: `npx jest --passWithNoTests 2>&1 | tail -20`
Expected: All pass (or pre-existing failures only)

- [ ] **Step 5: Final commit if any lint fixes**

```bash
git add -A
git status
# Only commit if there are changes from lint fixes
git diff --cached --stat && git commit -m "style: lint fixes for pe-email-sync"
```
