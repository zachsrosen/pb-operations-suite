# Google Chat OOO Bot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Google Chat bot that acts as Zach's OOO proxy — receives messages from the precon team, answers process/status questions via Claude with live data tools, and flags unknowns to an escalation queue.

**Architecture:** Async webhook pattern — immediate sync acknowledgment, then `waitUntil` fires Claude + tool calls in background and posts the real answer via Google Chat API `spaces.messages.create`. Three new Prisma models (conversation, escalation, config), `jose` for JWT verification, read-only tool subset from existing `chat-tools.ts` + new OOO-specific tools.

**Tech Stack:** Next.js API route, Anthropic SDK (`toolRunner` + `betaZodTool`), `jose` (JWT/JWKS), Google Chat API, Prisma/Neon Postgres, `@vercel/functions` `waitUntil`.

**Spec:** `docs/superpowers/specs/2026-05-26-google-chat-ooo-bot-design.md`

---

## Chunk 1: Schema, Dependencies, Auth Infrastructure

### Task 1: Install `jose` and add Prisma models

**Files:**
- Modify: `package.json` (add `jose`)
- Modify: `prisma/schema.prisma` (append 3 models at end of file)
- Modify: `.env.example` (add 2 new env vars)
- Create: `prisma/migrations/XXXX_ooo_bot/migration.sql` (via `prisma migrate dev`)

- [ ] **Step 1: Install jose**

```bash
npm install jose
```

- [ ] **Step 2: Add 3 new models to `prisma/schema.prisma`**

Append at end of file (after the last model):

```prisma
// ── OOO Bot ─────────────────────────────────────────────────

model OooBotConversation {
  id          String   @id @default(cuid())
  spaceId     String   // Google Chat space ID (unique per DM pair or Space)
  threadId    String?  // Thread ID for threaded replies; null for flat DMs
  senderEmail String
  senderName  String
  role        String   // "user" | "assistant"
  content     String
  model       String?  // Claude model used (assistant messages only)
  toolsUsed   String[] // Which tools Claude called
  createdAt   DateTime @default(now())

  @@index([spaceId, threadId, createdAt])
}

model OooBotEscalation {
  id           String    @id @default(cuid())
  senderEmail  String
  senderName   String
  question     String
  botContext    String?  // What the bot knew when it punted
  spaceId      String
  threadId     String?
  status       String   @default("PENDING") // PENDING | RESOLVED | DISMISSED
  resolvedAt   DateTime?
  resolvedNote String?
  createdAt    DateTime @default(now())

  @@index([status, createdAt])
}

model OooBotConfig {
  id           String   @id @default("default") // Singleton — always "default"
  playbook     String   // Markdown playbook content
  enabled      Boolean  @default(true)
  oooStartDate DateTime
  oooEndDate   DateTime
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 3: Add env vars to `.env.example`**

Add after the existing Google env vars section:

```bash
# Google Chat OOO Bot
GOOGLE_CHAT_PROJECT_NUMBER=your-gcp-project-number
GOOGLE_CHAT_ENABLED=false
```

- [ ] **Step 4: Generate migration**

```bash
npx prisma migrate dev --name ooo_bot
```

Expected: Migration created, Prisma client regenerated.

- [ ] **Step 5: Verify generated client includes new models**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json prisma/ .env.example src/generated/
git commit -m "feat: add OOO bot schema + jose dependency

Three new Prisma models: OooBotConversation, OooBotEscalation,
OooBotConfig. jose package for Google Chat JWT verification."
```

---

### Task 2: Google Chat JWT auth module

**Files:**
- Create: `src/lib/google-chat-auth.ts`
- Test: `src/__tests__/lib/google-chat-auth.test.ts`

This module verifies the JWT that Google Chat sends with every webhook request. Uses `jose` library's `createRemoteJWKSet` + `jwtVerify`.

- [ ] **Step 1: Write the test**

```typescript
// src/__tests__/lib/google-chat-auth.test.ts
import { verifyGoogleChatJwt } from "@/lib/google-chat-auth";

// Mock jose at module level
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

import { jwtVerify } from "jose";
const mockJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

describe("verifyGoogleChatJwt", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, GOOGLE_CHAT_PROJECT_NUMBER: "123456789" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns payload on valid JWT", async () => {
    const mockPayload = {
      iss: "chat@system.gserviceaccount.com",
      aud: "123456789",
      email: "user@photonbrothers.com",
    };
    mockJwtVerify.mockResolvedValueOnce({
      payload: mockPayload,
      protectedHeader: { alg: "RS256" },
    } as never);

    const result = await verifyGoogleChatJwt("Bearer fake-jwt-token");
    expect(result).toEqual({ valid: true, payload: mockPayload });
  });

  it("returns invalid when no auth header", async () => {
    const result = await verifyGoogleChatJwt(null);
    expect(result).toEqual({ valid: false, error: "Missing authorization header" });
  });

  it("returns invalid when auth header missing Bearer prefix", async () => {
    const result = await verifyGoogleChatJwt("Basic abc123");
    expect(result).toEqual({ valid: false, error: "Missing authorization header" });
  });

  it("returns invalid when JWT verification fails", async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error("JWT expired"));
    const result = await verifyGoogleChatJwt("Bearer expired-token");
    expect(result).toEqual({ valid: false, error: "JWT expired" });
  });

  it("returns invalid when GOOGLE_CHAT_PROJECT_NUMBER is missing", async () => {
    delete process.env.GOOGLE_CHAT_PROJECT_NUMBER;
    const result = await verifyGoogleChatJwt("Bearer some-token");
    expect(result).toEqual({ valid: false, error: "GOOGLE_CHAT_PROJECT_NUMBER not configured" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/google-chat-auth.test.ts --no-coverage
```

Expected: FAIL — module `@/lib/google-chat-auth` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/google-chat-auth.ts
/**
 * Google Chat JWT Verification
 *
 * Verifies the JWT that Google Chat sends with every webhook request.
 * Uses jose library with Google's JWKS endpoint for automatic key rotation.
 *
 * Ref: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_CHAT_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";

const EXPECTED_ISSUER = "chat@system.gserviceaccount.com";

// jose caches JWKS keys automatically; createRemoteJWKSet is safe to call once
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(GOOGLE_CHAT_JWKS_URL));
  }
  return _jwks;
}

export type VerifyResult =
  | { valid: true; payload: JWTPayload }
  | { valid: false; error: string };

/**
 * Verify Google Chat webhook JWT.
 * @param authHeader - The raw Authorization header value ("Bearer <token>")
 */
export async function verifyGoogleChatJwt(
  authHeader: string | null
): Promise<VerifyResult> {
  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (!projectNumber) {
    return { valid: false, error: "GOOGLE_CHAT_PROJECT_NUMBER not configured" };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing authorization header" };
  }

  const token = authHeader.slice("Bearer ".length).trim();

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: EXPECTED_ISSUER,
      audience: projectNumber,
    });
    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "JWT verification failed",
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/lib/google-chat-auth.test.ts --no-coverage
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-chat-auth.ts src/__tests__/lib/google-chat-auth.test.ts
git commit -m "feat: add Google Chat JWT verification module

jose-based JWT verification against Google's JWKS endpoint.
Validates issuer (chat@system.gserviceaccount.com) and audience
(GOOGLE_CHAT_PROJECT_NUMBER)."
```

---

### Task 3: Google Chat API client (async message posting)

**Files:**
- Create: `src/lib/google-chat-api.ts`
- Test: `src/__tests__/lib/google-chat-api.test.ts`

This module posts messages to Google Chat spaces/threads via the REST API using a service account token. Reuses the same JWT-signing pattern from `src/lib/google-calendar.ts` (`base64UrlEncode`, `signRS256`).

- [ ] **Step 1: Write the test**

```typescript
// src/__tests__/lib/google-chat-api.test.ts
import { postGoogleChatMessage } from "@/lib/google-chat-api";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("postGoogleChatMessage", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    process.env = {
      ...ORIGINAL_ENV,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@project.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("posts message to correct URL with thread", async () => {
    // Mock token fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "test-token" }),
    });
    // Mock message post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "spaces/xxx/messages/yyy" }),
    });

    await postGoogleChatMessage({
      spaceName: "spaces/abc123",
      threadName: "spaces/abc123/threads/def456",
      text: "Hello from bot",
    });

    // Second fetch call is the message post
    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toContain("spaces/abc123/messages");
    expect(url).toContain("messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.text).toBe("Hello from bot");
    expect(body.thread.name).toBe("spaces/abc123/threads/def456");
  });

  it("throws when service account not configured", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    await expect(
      postGoogleChatMessage({
        spaceName: "spaces/x",
        text: "Hi",
      })
    ).rejects.toThrow("Google service account not configured");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/google-chat-api.test.ts --no-coverage
```

Expected: FAIL — module `@/lib/google-chat-api` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/google-chat-api.ts
/**
 * Google Chat API Client
 *
 * Posts messages to Google Chat spaces/threads using the service account.
 * Used for async responses (the webhook returns immediately, then this
 * module posts the real answer once Claude finishes).
 *
 * Auth: Same JWT-signing pattern as google-calendar.ts — service account
 * email + private key → signed JWT → exchange for access token.
 */

import crypto from "crypto";

const CHAT_API_BASE = "https://chat.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

// ── Token cache (same approach as google-calendar.ts) ──

let _cachedToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function signRS256(data: string, privateKey: string): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKey, "base64");
  return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function getServiceAccountCreds() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google service account not configured");
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return { email, privateKey };
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (5-min buffer)
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 300_000) {
    return _cachedToken.token;
  }

  const { email, privateKey } = getServiceAccountCreds();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: CHAT_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await signRS256(signatureInput, privateKey);
  const jwt = `${signatureInput}.${signature}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || "unknown"}`);
  }

  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return _cachedToken.token;
}

// ── Public API ──

interface PostMessageParams {
  spaceName: string;      // e.g. "spaces/abc123"
  threadName?: string;    // e.g. "spaces/abc123/threads/def456"
  text: string;
}

/**
 * Post a message to a Google Chat space/thread.
 * If threadName is provided, replies in that thread.
 */
export async function postGoogleChatMessage(params: PostMessageParams): Promise<void> {
  const token = await getAccessToken();

  const url = new URL(`${CHAT_API_BASE}/${params.spaceName}/messages`);
  if (params.threadName) {
    url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  }

  const body: Record<string, unknown> = { text: params.text };
  if (params.threadName) {
    body.thread = { name: params.threadName };
  }

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "unknown");
    console.error(`[google-chat-api] Failed to post message: ${resp.status} ${errText}`);
    throw new Error(`Google Chat API error: ${resp.status}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/lib/google-chat-api.test.ts --no-coverage
```

Expected: Both tests PASS. (The RSA signing will fail with the test key, but fetch is mocked so the token fetch is intercepted before signing runs. If the test fails on signing, mock `getAccessToken` internally or adjust the test to mock the token fetch only.)

Note: If `signRS256` throws on the dummy key in tests, wrap the token-fetch mock to return before signing runs. The key tests here are URL construction and error handling, not crypto.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-chat-api.ts src/__tests__/lib/google-chat-api.test.ts
git commit -m "feat: add Google Chat API client for async message posting

Posts messages to Google Chat spaces/threads via REST API using
service account JWT auth. Same signing pattern as google-calendar.ts."
```

---

### Task 4: Extract read-only chat tools

**Files:**
- Modify: `src/lib/chat-tools.ts`
- Test: `src/__tests__/lib/chat-tools.test.ts` (existing — verify no regression)

The spec requires extracting the 4 read-only tools (`get_deal`, `search_deals`, `filter_deals_by_stage`, `count_deals_by_stage`) into a reusable function. The existing `createChatTools()` stays unchanged (callers unaffected).

- [ ] **Step 1: Add `createReadOnlyChatTools()` export to `chat-tools.ts`**

Add at the end of the file, before the closing:

```typescript
/**
 * Read-only subset of chat tools for contexts where write operations
 * (reviews, lock acquisition) are not appropriate — e.g. the OOO bot.
 */
export function createReadOnlyChatTools() {
  const getDeal = betaZodTool({
    name: "get_deal",
    description: "Get HubSpot deal properties for a specific deal by ID",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
    }),
    run: async (input) => {
      const { hubspotClient } = await import("@/lib/hubspot");
      const deal = await hubspotClient.crm.deals.basicApi.getById(
        input.dealId,
        [
          "dealname", "dealstage", "amount", "pb_location",
          "design_status", "permitting_status", "site_survey_status",
          "install_date", "inspection_date", "pto_date",
          "hubspot_owner_id", "closedate",
        ]
      );
      return JSON.stringify(deal.properties);
    },
  });

  const searchDeals = betaZodTool({
    name: "search_deals",
    description: "Search HubSpot deals by text query (searches deal name, stage, location)",
    inputSchema: z.object({
      query: z.string().describe("Search text"),
    }),
    run: async (input) => {
      const { hubspotClient } = await import("@/lib/hubspot");
      const response = await hubspotClient.crm.deals.searchApi.doSearch({
        query: input.query,
        limit: 10,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: ["createdate"],
      });
      return JSON.stringify(response.results.map((r) => r.properties));
    },
  });

  const filterDealsByStage = betaZodTool({
    name: "filter_deals_by_stage",
    description: "Find deals in a specific pipeline stage by stage display name, returning up to 20 matches",
    inputSchema: z.object({
      stage: z.string().describe("Stage display name, e.g. 'Construction'"),
    }),
    run: async (input) => {
      const { DEAL_STAGE_MAP, searchWithRetry } = await import("@/lib/hubspot");
      const normalizedStage = input.stage.trim().toLowerCase();
      const stageEntry = Object.entries(DEAL_STAGE_MAP).find(
        ([stageId, stageName]) =>
          stageName.toLowerCase() === normalizedStage ||
          stageId.toLowerCase() === normalizedStage
      ) ?? null;

      if (!stageEntry) {
        return JSON.stringify({
          error: `Unknown stage: ${input.stage}`,
          knownStages: Object.values(DEAL_STAGE_MAP),
        });
      }

      const [stageId, stageName] = stageEntry;
      const response = await searchWithRetry({
        filterGroups: [{
          filters: [{
            propertyName: "dealstage",
            operator: FilterOperatorEnum.Eq,
            value: stageId,
          }],
        }],
        limit: 20,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: ["createdate"],
      });

      return JSON.stringify({
        stage: stageName,
        count: response.results.length,
        deals: response.results.map((deal) => ({
          dealId: deal.id,
          dealname: deal.properties?.dealname ?? "",
          dealstage: stageName,
          amount: deal.properties?.amount ?? "",
          pb_location: deal.properties?.pb_location ?? "",
        })),
      });
    },
  });

  const countDealsByStage = betaZodTool({
    name: "count_deals_by_stage",
    description: "Count active deals by stage in the project pipeline",
    inputSchema: z.object({}),
    run: async () => {
      const { fetchAllProjects } = await import("@/lib/hubspot");
      const projects = await fetchAllProjects({ activeOnly: true });
      const counts = projects.reduce<Record<string, number>>((acc, project) => {
        const stage = project.stage || "Unknown";
        acc[stage] = (acc[stage] ?? 0) + 1;
        return acc;
      }, {});
      return JSON.stringify({ total: projects.length, counts });
    },
  });

  return [getDeal, searchDeals, filterDealsByStage, countDealsByStage];
}
```

Note: Yes, this duplicates the tool definitions from `createChatTools()`. This is intentional — DRY via shared tool factories would couple the two callers and make it harder to evolve them independently. The read-only subset is 4 tools; the duplication is manageable.

- [ ] **Step 2: Run existing chat-tools tests to verify no regression**

```bash
npx jest src/__tests__/lib/chat-tools.test.ts --no-coverage
```

Expected: All existing tests PASS (we only added a new export, didn't change anything).

- [ ] **Step 3: Run full typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat-tools.ts
git commit -m "feat: extract createReadOnlyChatTools from chat-tools

Read-only subset (get_deal, search_deals, filter_deals_by_stage,
count_deals_by_stage) for use by the OOO bot. Excludes run_review
and get_review_status which acquire locks."
```

---

## Chunk 2: Webhook Route + OOO Bot Core

### Task 5: Webhook route handler

**Files:**
- Create: `src/app/api/webhooks/google-chat/route.ts`
- Modify: `src/middleware.ts` (add to `PUBLIC_API_ROUTES`)

- [ ] **Step 1: Add route to `PUBLIC_API_ROUTES` in middleware**

In `src/middleware.ts`, add to the `PUBLIC_API_ROUTES` array (after the last webhook entry):

```typescript
"/api/webhooks/google-chat", // Google Chat OOO bot — JWT signature validated in route
```

- [ ] **Step 2: Create the webhook route**

```typescript
// src/app/api/webhooks/google-chat/route.ts
/**
 * POST /api/webhooks/google-chat
 *
 * Google Chat webhook for OOO bot. Receives messages from Google Chat,
 * returns an immediate acknowledgment, then fires Claude processing
 * asynchronously via waitUntil.
 *
 * Auth: Google JWT verified via jose against Google's JWKS.
 * Listed in PUBLIC_API_ROUTES — signature validation happens here.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyGoogleChatJwt } from "@/lib/google-chat-auth";
import { prisma } from "@/lib/db";
import { safeWaitUntil } from "@/lib/safe-wait-until";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── Google Chat event types ──

interface GoogleChatUser {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

interface GoogleChatMessage {
  name?: string;           // Globally unique message ID
  text?: string;           // Plain text content
  sender?: GoogleChatUser;
  thread?: { name?: string };
  space?: {
    name?: string;
    displayName?: string;
    type?: string;         // "DM" | "ROOM"
  };
  argumentText?: string;   // Text without @mention
  createTime?: string;
}

interface GoogleChatEvent {
  type?: string;           // "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE"
  eventTime?: string;
  message?: GoogleChatMessage;
  user?: GoogleChatUser;
  space?: {
    name?: string;
    displayName?: string;
    type?: string;
  };
}

// ── Welcome messages ──

const DM_WELCOME = `Hey — Zach's off pretending mountains exist outside of Colorado. I'm his AI stand-in. I've got his playbook, access to the live data, and zero ability to approve PTO. What's up?`;

const SPACE_WELCOME = `\u{1F44B} Zach's OOO bot reporting for duty. I've got his playbook loaded and can look up projects, schedules, and pipeline status. I can't approve anything or make promises, but I can usually point you in the right direction. If I'm stumped, I'll flag it for Zach when he's back June 10th.`;

const THINKING_MESSAGE = `\u{1F914} Let me check on that...`;

// ── Route handler ──

export async function POST(request: NextRequest) {
  // ── Kill switch ──
  const enabled = (process.env.GOOGLE_CHAT_ENABLED || "false").toLowerCase().trim();
  if (enabled !== "true" && enabled !== "1") {
    return NextResponse.json({ text: "OOO bot is currently disabled." });
  }

  // ── JWT auth ──
  const authHeader = request.headers.get("authorization");
  const authResult = await verifyGoogleChatJwt(authHeader);
  if (!authResult.valid) {
    console.error(`[google-chat] JWT verification failed: ${authResult.error}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse event ──
  let event: GoogleChatEvent;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type;

  // ── REMOVED_FROM_SPACE: no-op ──
  if (eventType === "REMOVED_FROM_SPACE") {
    return NextResponse.json({});
  }

  // ── ADDED_TO_SPACE: welcome message (sync) ──
  if (eventType === "ADDED_TO_SPACE") {
    const isRoom = event.space?.type === "ROOM";
    return NextResponse.json({ text: isRoom ? SPACE_WELCOME : DM_WELCOME });
  }

  // ── MESSAGE: async processing ──
  if (eventType === "MESSAGE") {
    const message = event.message;
    const senderEmail = message?.sender?.email ?? event.user?.email;
    const senderName = message?.sender?.displayName ?? event.user?.displayName ?? "Unknown";
    const spaceName = message?.space?.name ?? event.space?.name;
    const threadName = message?.thread?.name;
    const messageText = message?.argumentText ?? message?.text ?? "";
    const messageName = message?.name; // Unique ID for idempotency

    // ── Sender domain filtering ──
    if (!senderEmail?.endsWith("@photonbrothers.com")) {
      return NextResponse.json({
        text: "I only respond to Photon Brothers team members.",
      });
    }

    if (!spaceName) {
      console.error("[google-chat] MESSAGE event missing space name");
      return NextResponse.json({});
    }

    if (!messageText.trim()) {
      return NextResponse.json({ text: "I can only respond to text messages." });
    }

    // ── Idempotency check ──
    if (messageName && prisma) {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key_scope: { key: messageName, scope: "google-chat" } },
      });
      if (existing) {
        // Already processed this message — return 200, no action
        return NextResponse.json({});
      }
      // Claim the key
      await prisma.idempotencyKey.create({
        data: {
          key: messageName,
          scope: "google-chat",
          status: "processing",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
        },
      });
    }

    // ── DB config check (is bot enabled in config?) ──
    let config: { enabled: boolean; playbook: string } | null = null;
    if (prisma) {
      const row = await prisma.oooBotConfig.findFirst();
      if (row && !row.enabled) {
        return NextResponse.json({
          text: "The OOO bot is currently turned off. Reach out to Caleb or Patrick if you need help.",
        });
      }
      config = row;
    }

    // ── Fire async Claude processing ──
    safeWaitUntil(
      (async () => {
        try {
          const { processOooBotMessage } = await import("@/lib/ooo-bot");
          await processOooBotMessage({
            messageText,
            senderEmail,
            senderName,
            spaceName,
            threadName: threadName ?? undefined,
            spaceDisplayName: message?.space?.displayName ?? event.space?.displayName,
            playbook: config?.playbook ?? "",
          });
        } catch (err) {
          console.error("[google-chat] Async processing failed:", err);
          // Post fallback error message
          try {
            const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
            await postGoogleChatMessage({
              spaceName,
              threadName: threadName ?? undefined,
              text: "I ran into a technical issue processing that. Try again in a minute — if it keeps happening, ping Caleb or Patrick on IT.",
            });
          } catch (postErr) {
            console.error("[google-chat] Failed to post error fallback:", postErr);
          }
        }
      })()
    );

    // ── Return immediate ack ──
    return NextResponse.json({ text: THINKING_MESSAGE });
  }

  // ── Unknown event type: no-op ──
  return NextResponse.json({});
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: Will have an error for missing `@/lib/ooo-bot` (not created yet). That's expected — we'll create it in the next task. The route itself should type-check once `ooo-bot.ts` exists.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/google-chat/route.ts src/middleware.ts
git commit -m "feat: add Google Chat webhook route with async response pattern

Validates Google JWT, deduplicates via IdempotencyKey, returns
immediate ack, fires Claude processing via waitUntil. Includes
kill switch, domain filtering, welcome messages."
```

---

### Task 6: OOO Bot tools

**Files:**
- Create: `src/lib/ooo-bot-tools.ts`
- Test: `src/__tests__/lib/ooo-bot-tools.test.ts`

The 5 OOO-specific tools: `get_project_status`, `get_schedule_overview`, `get_service_queue`, `escalate`, `search_sop`.

- [ ] **Step 1: Write tests for the escalate and search_sop tools**

These are the two tools we can meaningfully unit test (they hit the DB, not external APIs). The HubSpot/Calendar tools are integration-tested via the existing patterns.

```typescript
// src/__tests__/lib/ooo-bot-tools.test.ts
import { createOooBotTools } from "@/lib/ooo-bot-tools";

// Minimal mock to extract tools by name
function getToolByName(tools: ReturnType<typeof createOooBotTools>, name: string) {
  return tools.find((t) => t.name === name);
}

describe("createOooBotTools", () => {
  it("returns 5 tools", () => {
    const tools = createOooBotTools();
    expect(tools).toHaveLength(5);
  });

  it("includes expected tool names", () => {
    const tools = createOooBotTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_project_status",
        "get_schedule_overview",
        "get_service_queue",
        "escalate",
        "search_sop",
      ])
    );
  });

  it("all tools have descriptions", () => {
    const tools = createOooBotTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/ooo-bot-tools.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/ooo-bot-tools.ts
/**
 * OOO Bot Tool Definitions
 *
 * Tools specific to the OOO bot that aren't in the standard chat tools.
 * All tools are READ-ONLY — no mutations except OooBotEscalation writes.
 *
 * Uses betaZodTool (same pattern as chat-tools.ts).
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export function createOooBotTools() {
  const getProjectStatus = betaZodTool({
    name: "get_project_status",
    description:
      "Get combined status for a project: deal properties, Zuper job status, " +
      "and BOM snapshot. Accepts PROJ-XXXX format or a HubSpot deal ID.",
    inputSchema: z.object({
      projectId: z
        .string()
        .describe("PROJ-XXXX number or HubSpot deal ID"),
    }),
    run: async (input) => {
      const { hubspotClient, searchWithRetry } = await import("@/lib/hubspot");
      const { FilterOperatorEnum } = await import(
        "@hubspot/api-client/lib/codegen/crm/deals"
      );

      // Resolve deal ID from PROJ-XXXX if needed
      let dealId = input.projectId;
      if (input.projectId.startsWith("PROJ-")) {
        const searchResult = await searchWithRetry({
          query: input.projectId,
          limit: 1,
          properties: ["dealname"],
          sorts: ["createdate"],
        });
        if (!searchResult.results.length) {
          return JSON.stringify({ error: `No deal found for ${input.projectId}` });
        }
        dealId = searchResult.results[0].id;
      }

      // Fetch deal properties
      const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
        "dealname", "dealstage", "amount", "pb_location",
        "design_status", "permitting_status", "site_survey_status",
        "install_date", "inspection_date", "pto_date",
        "system_size_kw", "module_type", "inverter_type",
        "battery_type", "battery_count",
      ]);

      // Check for Zuper job
      const { prisma } = await import("@/lib/db");
      let zuperStatus: string | null = null;
      if (prisma) {
        const jobCache = await prisma.zuperJobCache.findFirst({
          where: { dealId },
          select: { status: true, jobUid: true },
        });
        zuperStatus = jobCache?.status ?? null;
      }

      // Check for BOM snapshot
      let bomStatus: { version: number; itemCount: number; pushedToHubSpot: boolean } | null = null;
      if (prisma) {
        const snapshot = await prisma.projectBomSnapshot.findFirst({
          where: { dealId },
          orderBy: { version: "desc" },
          select: { version: true, items: true },
        });
        if (snapshot) {
          const pushLog = await prisma.bomHubSpotPushLog.findFirst({
            where: { dealId, result: "SUCCESS" },
            orderBy: { createdAt: "desc" },
          });
          const items = (snapshot.items as unknown[]) ?? [];
          bomStatus = {
            version: snapshot.version,
            itemCount: Array.isArray(items) ? items.length : 0,
            pushedToHubSpot: !!pushLog,
          };
        }
      }

      return JSON.stringify({
        dealId,
        properties: deal.properties,
        zuper: zuperStatus ? { status: zuperStatus } : null,
        bom: bomStatus,
      });
    },
  });

  const getScheduleOverview = betaZodTool({
    name: "get_schedule_overview",
    description:
      "Get upcoming installs and surveys for the next N days, optionally filtered by location. " +
      "Reads from all location-specific Google Calendars.",
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe(
          "Filter by location: westminster, centennial, cosp, california, camarillo. Omit for all."
        ),
      days: z
        .number()
        .optional()
        .default(7)
        .describe("How many days ahead to look (default 7)"),
    }),
    run: async (input) => {
      // Calendar IDs by location bucket
      const calendarMap: Record<string, string | undefined> = {
        westminster: process.env.GOOGLE_INSTALL_CALENDAR_WESTY_ID,
        westy: process.env.GOOGLE_INSTALL_CALENDAR_WESTY_ID,
        centennial: process.env.GOOGLE_INSTALL_CALENDAR_DTC_ID,
        dtc: process.env.GOOGLE_INSTALL_CALENDAR_DTC_ID,
        cosp: process.env.GOOGLE_INSTALL_CALENDAR_COSP_ID,
        colorado_springs: process.env.GOOGLE_INSTALL_CALENDAR_COSP_ID,
        california: process.env.GOOGLE_INSTALL_CALENDAR_CA_ID,
        slo: process.env.GOOGLE_INSTALL_CALENDAR_CA_ID,
        camarillo: process.env.GOOGLE_INSTALL_CALENDAR_CAMARILLO_ID,
      };

      // Determine which calendars to query
      let calendarIds: string[];
      if (input.location) {
        const normalized = input.location.toLowerCase().replace(/\s+/g, "_");
        const id = calendarMap[normalized];
        if (!id) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: ["westminster", "centennial", "cosp", "california", "camarillo"],
          });
        }
        calendarIds = [id];
      } else {
        // All unique calendar IDs
        calendarIds = [...new Set(Object.values(calendarMap).filter(Boolean))] as string[];
      }

      if (!calendarIds.length) {
        return JSON.stringify({ error: "No calendars configured" });
      }

      // v1: Direct calendar reads require the calendar.events scope, which
      // the Chat API service account token doesn't have. Rather than adding
      // a second token flow, hit the existing scheduler API internally.
      // This is a stretch goal — deal/pipeline tools are the core value.
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + (input.days ?? 7));

      return JSON.stringify({
        range: { from: now.toISOString(), to: endDate.toISOString() },
        locations: input.location ? [input.location] : ["all"],
        note: "For detailed schedule, check pbtechops.com/dashboards/scheduler. " +
              "Calendar read integration is a post-OOO enhancement.",
      });
    },
  });

  const getServiceQueue = betaZodTool({
    name: "get_service_queue",
    description:
      "Get the top 10 service priority queue items with scores and tiers. " +
      "Shows what's critical, high, medium, and low priority in the service pipeline.",
    inputSchema: z.object({}),
    run: async () => {
      try {
        // Hit the existing priority-queue API endpoint internally.
        // This is simpler than duplicating the 60-line fetchServiceDeals()
        // assembly logic that lives in the route file.
        const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
        const apiToken = process.env.API_SECRET_TOKEN;
        const resp = await fetch(`${baseUrl}/api/service/priority-queue`, {
          headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        });

        if (!resp.ok) {
          return JSON.stringify({
            error: `Service queue API returned ${resp.status}`,
            note: "Check pbtechops.com/dashboards/service-overview for current queue",
          });
        }

        const data = await resp.json();
        const queue = data.queue ?? [];

        // Top 10 by score (API returns sorted)
        const top10 = queue.slice(0, 10).map((item: Record<string, unknown>) => ({
          dealId: item.dealId,
          dealName: item.dealName,
          score: item.score,
          tier: item.tier,
          location: item.location,
          topReasons: ((item.reasons as string[]) ?? []).slice(0, 2),
        }));

        return JSON.stringify({
          total: queue.length,
          top10,
          summary: data.summary ?? {},
        });
      } catch (err) {
        return JSON.stringify({
          error: `Service queue unavailable: ${err instanceof Error ? err.message : "unknown"}`,
          note: "Check pbtechops.com/dashboards/service-overview for current queue",
        });
      }
    },
  });

  const escalate = betaZodTool({
    name: "escalate",
    description:
      "Flag a question that you can't confidently answer for Zach to review when he returns. " +
      "Use this when the question requires judgment, approval, or information you don't have.",
    inputSchema: z.object({
      question: z.string().describe("The original question from the user"),
      context: z
        .string()
        .describe("What you know about this question and why you're escalating"),
    }),
    run: async (input) => {
      // NOTE: The orchestrator in ooo-bot.ts wraps this tool and replaces
      // `run` entirely to inject request context (senderEmail, spaceName,
      // etc.). This default implementation is only hit in unit tests or
      // if someone calls createOooBotTools() standalone (unlikely).
      // It does NOT write to the DB — the orchestrator wrapper handles that.
      return JSON.stringify({
        escalated: true,
        message: "Flagged for Zach — he's back June 10th.",
      });
    },
  });

  const searchSop = betaZodTool({
    name: "search_sop",
    description:
      "Search the SOP (Standard Operating Procedures) guides for process documentation. " +
      "Use this for how-to questions about scheduling, pipeline, HubSpot workflows, etc.",
    inputSchema: z.object({
      query: z.string().describe("Topic keyword or question to search for"),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) {
        return JSON.stringify({ error: "Database not available" });
      }

      // Search SOP sections by title and content (case-insensitive)
      const sections = await prisma.sopSection.findMany({
        where: {
          OR: [
            { title: { contains: input.query, mode: "insensitive" } },
            { content: { contains: input.query, mode: "insensitive" } },
          ],
        },
        include: {
          tab: { select: { label: true } },
        },
        take: 5,
        orderBy: { sortOrder: "asc" },
      });

      if (!sections.length) {
        return JSON.stringify({
          results: [],
          note: `No SOP sections found for "${input.query}". Try different keywords.`,
        });
      }

      // Strip HTML tags and truncate content
      const results = sections.map((s) => ({
        tab: s.tab.label,
        title: s.title,
        content: s.content
          .replace(/<[^>]+>/g, " ")  // Strip HTML
          .replace(/\s+/g, " ")       // Collapse whitespace
          .trim()
          .slice(0, 2000),            // Truncate to 2000 chars
      }));

      return JSON.stringify({ results });
    },
  });

  return [getProjectStatus, getScheduleOverview, getServiceQueue, escalate, searchSop];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/lib/ooo-bot-tools.test.ts --no-coverage
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ooo-bot-tools.ts src/__tests__/lib/ooo-bot-tools.test.ts
git commit -m "feat: add OOO bot tools (project status, schedule, service queue, escalate, SOP search)

Five read-only tools for the OOO bot. escalate writes to
OooBotEscalation table. search_sop queries existing SOP sections."
```

---

### Task 7: OOO Bot orchestrator

**Files:**
- Create: `src/lib/ooo-bot.ts`
- Test: `src/__tests__/lib/ooo-bot.test.ts`

This is the core orchestrator: loads conversation history, builds the system prompt (3 layers), calls Claude with toolRunner, persists the conversation, and posts the response via the Chat API.

- [ ] **Step 1: Write the test**

```typescript
// src/__tests__/lib/ooo-bot.test.ts
import { buildOooBotSystemPrompt } from "@/lib/ooo-bot";

describe("buildOooBotSystemPrompt", () => {
  it("includes identity section", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Alice",
      senderEmail: "alice@photonbrothers.com",
      spaceDisplayName: "Precon Team",
    });
    expect(prompt).toContain("Zach's OOO assistant");
    expect(prompt).toContain("Photon Brothers");
  });

  it("includes playbook when provided", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "## Priority: PROJ-1234 is urgent",
      senderName: "Bob",
      senderEmail: "bob@photonbrothers.com",
    });
    expect(prompt).toContain("PROJ-1234 is urgent");
  });

  it("includes sender context", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Carol",
      senderEmail: "carol@photonbrothers.com",
      spaceDisplayName: "Test Space",
    });
    expect(prompt).toContain("Carol");
    expect(prompt).toContain("carol@photonbrothers.com");
    expect(prompt).toContain("Test Space");
  });

  it("shows Direct Message when no space name", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Dave",
      senderEmail: "dave@photonbrothers.com",
    });
    expect(prompt).toContain("Direct Message");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/ooo-bot.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/ooo-bot.ts
/**
 * OOO Bot Orchestrator
 *
 * Core logic: loads conversation history, builds system prompt,
 * calls Claude with toolRunner, persists conversation, posts response
 * via Google Chat API.
 *
 * Called from the webhook route's waitUntil() — runs asynchronously
 * after the immediate "thinking..." response.
 */

import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { createReadOnlyChatTools } from "@/lib/chat-tools";
import { createOooBotTools } from "@/lib/ooo-bot-tools";
import { postGoogleChatMessage } from "@/lib/google-chat-api";
import { prisma } from "@/lib/db";

// ── System Prompt Builder ──

interface SystemPromptParams {
  playbook: string;
  senderName: string;
  senderEmail: string;
  spaceDisplayName?: string;
}

const IDENTITY_PROMPT = `You are Zach's OOO assistant for the precon team at Photon Brothers (a solar installation company). Zach is out of office from May 29 to June 10, 2026.

You have Zach's operational playbook and access to live project data. You help the precon team with process questions, project status lookups, scheduling visibility, and general guidance based on how Zach runs things.

RULES:
- Always identify yourself as Zach's OOO bot, never pretend to be Zach
- You CANNOT: approve things, make commitments, change data, reassign crews, move deals, send emails, or override anyone's decisions
- If you're not confident in an answer, use the escalate tool to flag it for Zach's return
- When you escalate, tell the person it's been queued for Zach
- For process/how-to questions, use the search_sop tool first — the SOP guides have most standard procedures documented
- Be helpful, direct, and a little funny — like a coworker who knows the playbook and has a sense of humor about being a robot filling in

TONE:
- Casual and direct, not corporate
- Self-aware about being an AI ("above my pay grade — I don't have one")
- Confident when you know the answer, honest when you don't
- Brief — nobody wants a novel in Google Chat

AVAILABLE TOOLS:
- get_deal(dealId) — HubSpot deal properties
- search_deals(query) — search deals by name/text
- filter_deals_by_stage(stage) — find deals in a pipeline stage
- count_deals_by_stage() — pipeline stage counts
- get_project_status(projectId) — combined deal + Zuper + BOM status
- get_schedule_overview(location?, days?) — upcoming installs/surveys
- get_service_queue() — service priority queue summary
- escalate(question, context) — flag for Zach's return
- search_sop(query) — search SOP guides for process docs

KEY CONTEXT:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
- Pipeline stages: Site Survey > Design & Engineering > Permitting & Interconnection > RTB - Blocked > Ready To Build > Construction > Inspection > Permission To Operate > Close Out`;

export function buildOooBotSystemPrompt(params: SystemPromptParams): string {
  let prompt = IDENTITY_PROMPT;

  // Layer 2: Playbook
  if (params.playbook.trim()) {
    prompt += `\n\n--- ZACH'S PLAYBOOK ---\n${params.playbook}`;
  }

  // Layer 3: Live context
  prompt += `\n\n--- CURRENT CONTEXT ---`;
  prompt += `\nCurrent date/time: ${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })}`;
  prompt += `\nMessage from: ${params.senderName} (${params.senderEmail})`;
  prompt += `\nSpace: ${params.spaceDisplayName || "Direct Message"}`;

  return prompt;
}

// ── Message Processor ──

interface ProcessMessageParams {
  messageText: string;
  senderEmail: string;
  senderName: string;
  spaceName: string;        // Google Chat space resource name
  threadName?: string;       // Google Chat thread resource name
  spaceDisplayName?: string;
  playbook: string;
}

export async function processOooBotMessage(params: ProcessMessageParams): Promise<void> {
  const {
    messageText,
    senderEmail,
    senderName,
    spaceName,
    threadName,
    spaceDisplayName,
    playbook,
  } = params;

  // ── Load conversation history ──
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (prisma) {
    const rows = await prisma.oooBotConversation.findMany({
      where: {
        spaceId: spaceName,
        ...(threadName ? { threadId: threadName } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { role: true, content: true },
    });
    // Reverse so oldest first
    history = rows.reverse().map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));
  }

  // ── Build system prompt ──
  const systemPrompt = buildOooBotSystemPrompt({
    playbook,
    senderName,
    senderEmail,
    spaceDisplayName,
  });

  // ── Build messages ──
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history,
    { role: "user", content: messageText },
  ];

  // ── Build tools ──
  // Read-only chat tools + OOO-specific tools
  const readOnlyTools = createReadOnlyChatTools();
  const rawOooTools = createOooBotTools();

  // Wrap the escalate tool to inject request context
  const oooTools = rawOooTools.map((tool) => {
    if (tool.name === "escalate") {
      const originalRun = tool.run;
      return {
        ...tool,
        run: async (input: { question: string; context: string }) => {
          // Write escalation with real context
          if (prisma) {
            await prisma.oooBotEscalation.create({
              data: {
                senderEmail,
                senderName,
                question: input.question,
                botContext: input.context,
                spaceId: spaceName,
                threadId: threadName,
                status: "PENDING",
              },
            });
          }
          return JSON.stringify({
            escalated: true,
            message: "Flagged for Zach — he's back June 10th.",
          });
        },
      };
    }
    return tool;
  });

  // ── Wrap all tools to track usage ──
  // toolRunner returns only the final text message — intermediate tool_use
  // blocks are internal. We track usage by wrapping each tool's run function.
  const toolsUsedSet = new Set<string>();
  const allTools = [...readOnlyTools, ...oooTools].map((tool) => ({
    ...tool,
    run: async (input: unknown) => {
      toolsUsedSet.add(tool.name);
      return (tool.run as (input: unknown) => Promise<string>)(input);
    },
  }));

  // ── Call Claude ──
  const client = getAnthropicClient();

  const finalMessage = await client.beta.messages.toolRunner({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    tools: allTools as Parameters<typeof client.beta.messages.toolRunner>[0]["tools"],
    max_iterations: 5,
  });

  // Extract text response
  const textBlocks = finalMessage.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text"
  );
  const responseText = textBlocks.map((b) => b.text).join("");

  const toolsUsed = [...toolsUsedSet];

  // ── Persist conversation ──
  if (prisma) {
    await prisma.$transaction([
      prisma.oooBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail,
          senderName,
          role: "user",
          content: messageText,
        },
      }),
      prisma.oooBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail: "bot",
          senderName: "Zach's OOO Bot",
          role: "assistant",
          content: responseText,
          model: CLAUDE_MODELS.sonnet,
          toolsUsed,
        },
      }),
    ]);
  }

  // ── Post response to Google Chat ──
  await postGoogleChatMessage({
    spaceName,
    threadName,
    text: responseText || "I processed your message but didn't have anything to say. Try asking a specific question?",
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/lib/ooo-bot.test.ts --no-coverage
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: Clean — all modules now exist and reference each other correctly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ooo-bot.ts src/__tests__/lib/ooo-bot.test.ts
git commit -m "feat: add OOO bot orchestrator

Core logic: loads conversation history, builds 3-layer system prompt
(identity + playbook + live context), calls Claude with toolRunner,
persists conversation, posts async response via Chat API."
```

---

## Chunk 3: Config Seed, Escalation API, Final Wiring

### Task 8: Seed OooBotConfig with placeholder playbook

**Files:**
- Create: `scripts/seed-ooo-bot-config.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// scripts/seed-ooo-bot-config.ts
/**
 * Seed OooBotConfig with a placeholder playbook.
 * Run: npx tsx scripts/seed-ooo-bot-config.ts
 *
 * Uses upsert — safe to re-run. Updates the playbook content
 * without losing the enabled/date config.
 */

import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient();

const PLACEHOLDER_PLAYBOOK = `## Current Priority Projects
- (To be filled in with Zach before OOO)

## Standing Rules (things Zach would decide on the spot)
- If a project is stuck in permitting for >10 business days, check the AHJ tracker
- If an install gets rained out, check the next available slot on the scheduler before calling the customer
- If someone asks about a BOM approval, tell them to hold until Zach is back unless it's blocking an install this week

## Who Handles What While I'm Out
- Scheduling conflicts: (TBD)
- BOM questions: (TBD)
- Design reviews: (TBD)
- IT issues: Caleb or Patrick

## Things to Hold for My Return
- Any new vendor approvals
- Changes to crew assignments
- Budget approvals over $5k

## Key Contacts
- Caleb: IT, system issues
- Patrick: IT, system issues
- Nathan Kirkegaard: Covering Westminster survey slots
`;

async function main() {
  const result = await prisma.oooBotConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      playbook: PLACEHOLDER_PLAYBOOK,
      enabled: true,
      oooStartDate: new Date("2026-05-29T00:00:00-06:00"),
      oooEndDate: new Date("2026-06-10T23:59:59-06:00"),
    },
    update: {
      playbook: PLACEHOLDER_PLAYBOOK,
    },
  });

  console.log(`OooBotConfig seeded: id=${result.id}, enabled=${result.enabled}`);
  console.log(`OOO period: ${result.oooStartDate.toISOString()} → ${result.oooEndDate.toISOString()}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run the seed**

```bash
npx tsx scripts/seed-ooo-bot-config.ts
```

Expected: "OooBotConfig seeded: id=default, enabled=true"

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-ooo-bot-config.ts
git commit -m "feat: add OooBotConfig seed script with placeholder playbook

Run npx tsx scripts/seed-ooo-bot-config.ts to seed/update.
Placeholder content to be replaced with real playbook before OOO."
```

---

### Task 9: Escalation review API endpoint

**Files:**
- Create: `src/app/api/admin/ooo-bot/escalations/route.ts`

Minimal API for reviewing escalations when Zach returns. Admin-only (covered by existing `ADMIN_ONLY_ROUTES` prefix check in middleware).

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/admin/ooo-bot/escalations/route.ts
/**
 * GET /api/admin/ooo-bot/escalations
 * PATCH /api/admin/ooo-bot/escalations
 *
 * Admin-only endpoint for reviewing OOO bot escalations.
 * GET: list pending escalations
 * PATCH: resolve/dismiss an escalation
 *
 * Covered by ADMIN_ONLY_ROUTES prefix check in middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const escalations = await prisma.oooBotEscalation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ escalations, count: escalations.length });
}

export async function PATCH(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  let body: { id?: string; status?: string; resolvedNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  if (!["RESOLVED", "DISMISSED"].includes(body.status)) {
    return NextResponse.json(
      { error: "status must be RESOLVED or DISMISSED" },
      { status: 400 }
    );
  }

  const updated = await prisma.oooBotEscalation.update({
    where: { id: body.id },
    data: {
      status: body.status,
      resolvedNote: body.resolvedNote ?? null,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({ escalation: updated });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/ooo-bot/escalations/route.ts
git commit -m "feat: add admin API for OOO bot escalation review

GET /api/admin/ooo-bot/escalations — list pending
PATCH — resolve or dismiss with optional note"
```

---

### Task 10: Full typecheck and lint

- [ ] **Step 1: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: Clean (or only pre-existing warnings).

- [ ] **Step 3: Run all OOO bot tests**

```bash
npx jest --testPathPattern="ooo-bot|google-chat" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 4: Fix any issues found**

Address typecheck, lint, or test failures.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix lint and type errors from OOO bot implementation"
```

---

### Task 11: Deploy and verify

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin feat/ooo-chat-bot
```

Create PR via `gh pr create`.

- [ ] **Step 2: Set Vercel env vars**

Must be set before the bot will work:

```bash
printf '%s' 'YOUR_PROJECT_NUMBER' | vercel env add GOOGLE_CHAT_PROJECT_NUMBER production
printf '%s' 'true' | vercel env add GOOGLE_CHAT_ENABLED production
```

- [ ] **Step 3: Merge PR and verify deployment**

After Vercel preview passes:

```bash
gh pr merge --squash
```

- [ ] **Step 4: Verify webhook endpoint is live**

```bash
curl -s -o /dev/null -w "%{http_code}" https://pbtechops.com/api/webhooks/google-chat
```

Expected: 401 (JWT missing — this means the route is live and rejecting unauthenticated requests).

- [ ] **Step 5: Configure Google Chat App in GCP console**

Manual step (Zach or Caleb):
1. Enable Google Chat API in GCP project
2. Configure Chat App with HTTP endpoint: `https://pbtechops.com/api/webhooks/google-chat`
3. Set visibility to precon team emails
4. Add `chat.bot` scope to service account domain-wide delegation

- [ ] **Step 6: Test in Google Chat**

Send a DM to the bot from a precon team member account. Verify:
- Immediate "thinking" response appears
- Real Claude response follows within 10-20 seconds
- Tools work (try "how many deals are in Construction?")
- Escalation works (try asking something the bot can't answer)

---

### Task 12: Update playbook with real content

- [ ] **Step 1: Session with Zach (20-30 min)**

Walk through the playbook template and fill in:
- Current priority projects
- Standing rules
- Who handles what
- Judgment calls
- Things to hold

- [ ] **Step 2: Update via Prisma Studio or SQL**

```sql
UPDATE "OooBotConfig"
SET playbook = '... real content ...',
    "updatedAt" = NOW()
WHERE id = 'default';
```

- [ ] **Step 3: Verify bot uses updated playbook**

Send a test message referencing one of the priority projects. Verify the bot's response reflects the new playbook content.
