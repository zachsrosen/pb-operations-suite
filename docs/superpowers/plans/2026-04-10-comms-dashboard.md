# Comms Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb the standalone unified-inbox-live Express.js app into PB Ops Suite as a Comms dashboard under the Operations suite — Gmail inbox, Google Chat, HubSpot categorization, AI-assisted drafts, and bulk actions.

**Architecture:** Full-page fetch with no server-side message cache. Each API request fetches the current page from Gmail/Chat APIs via raw `fetch` (matching `google-calendar.ts` pattern). Client polls every 60s via React Query `refetchInterval`. Separate Google OAuth flow for Gmail/Chat scopes (not combined with NextAuth login). Impersonation blocked at the API layer.

**Tech Stack:** Next.js API routes, Prisma (Neon Postgres), React Query v5, raw `fetch` against Gmail/Chat REST APIs, Anthropic Claude for AI drafts, AES-256-GCM token encryption, Tailwind v4 + DashboardShell.

**Spec:** `docs/superpowers/specs/2026-04-10-comms-dashboard-design.md`

**Design choices locked in for this plan:**

1. **Impersonation handling:** Dedicated `getActualCommsUser()` that resolves the real session user (ignoring impersonation) AND all Comms API routes return 403 when impersonation is active. Frontend shows an `ImpersonationBlockBanner` on the Comms page.

2. **Chat bounds:** Max 30 spaces, 20 messages per space, sorted by `createTime` descending. Chat messages are interleaved with Gmail messages by timestamp in the unified page. If the unified page needs more messages beyond the initial window, the response includes per-source `nextPageToken` values for "Load more" pagination.

---

## Chunk 1: Foundation (Database, Auth, Crypto, Token Management)

### Task 1: Prisma Schema — Add Comms Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add CommsGmailToken model**

In `prisma/schema.prisma`, after the existing models, add:

```prisma
model CommsGmailToken {
  id                Int      @id @default(autoincrement())
  userId            String   @unique
  user              User     @relation("UserCommsGmailToken", fields: [userId], references: [id])
  gmailAccessToken  String
  gmailRefreshToken String
  gmailTokenExpiry  BigInt   @default(0)
  chatEnabled       Boolean  @default(false)
  scopes            String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model CommsAiMemory {
  id        Int      @id @default(autoincrement())
  userId    String
  user      User     @relation("UserCommsAiMemory", fields: [userId], references: [id])
  kind      String
  key       String   @default("")
  data      Json
  createdAt DateTime @default(now())

  @@index([userId, kind])
  @@index([userId, kind, key])
}

model CommsUserState {
  id              Int      @id @default(autoincrement())
  userId          String   @unique
  user            User     @relation("UserCommsUserState", fields: [userId], references: [id])
  gmailHistoryId  String   @default("")
  chatLastSyncAt  DateTime?
  lastRefreshedAt DateTime?
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 2: Add relation fields to User model**

In the `User` model, add these relation fields alongside the existing relations:

```prisma
  // Comms
  commsGmailToken   CommsGmailToken?  @relation("UserCommsGmailToken")
  commsAiMemories   CommsAiMemory[]   @relation("UserCommsAiMemory")
  commsUserState    CommsUserState?   @relation("UserCommsUserState")
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-comms-models
```

Expected: Migration creates three new tables with indexes and foreign keys.

- [ ] **Step 4: Verify Prisma client generation**

Run:
```bash
npx prisma generate
```

Expected: No errors. The `CommsGmailToken`, `CommsAiMemory`, and `CommsUserState` types are available in `@/generated/prisma`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(comms): add Prisma models for Gmail tokens, AI memory, user state"
```

---

### Task 2: Token Encryption — `comms-crypto.ts`

**Files:**
- Create: `src/lib/comms-crypto.ts`
- Test: `src/__tests__/comms-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/comms-crypto.test.ts`:

```typescript
import { commsEncryptToken, commsDecryptToken } from "@/lib/comms-crypto";

describe("comms-crypto", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // 32 bytes = 64 hex chars
    process.env.COMMS_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("encrypts and decrypts a token round-trip", () => {
    const plaintext = "ya29.a0AfH6SMBx-test-access-token";
    const encrypted = commsEncryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);
    const decrypted = commsDecryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("returns empty string for empty input", () => {
    expect(commsEncryptToken("")).toBe("");
    expect(commsDecryptToken("")).toBe("");
  });

  test("returns plaintext if no encryption key is set", () => {
    delete process.env.COMMS_TOKEN_ENCRYPTION_KEY;
    const token = "test-token";
    expect(commsEncryptToken(token)).toBe(token);
    expect(commsDecryptToken(token)).toBe(token);
  });

  test("throws if encryption key is wrong length", () => {
    process.env.COMMS_TOKEN_ENCRYPTION_KEY = "tooshort";
    expect(() => commsEncryptToken("test")).toThrow("32 bytes");
  });

  test("different encryptions of same plaintext produce different ciphertext", () => {
    const token = "same-token";
    const a = commsEncryptToken(token);
    const b = commsEncryptToken(token);
    expect(a).not.toBe(b); // random IV each time
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/comms-crypto.test.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/comms-crypto.ts`:

```typescript
/**
 * AES-256-GCM encryption for Comms Gmail/Chat OAuth tokens.
 * Same algorithm as the original unified-inbox-live user-db.js.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const raw = process.env.COMMS_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "COMMS_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)"
    );
  }
  return buf;
}

export function commsEncryptToken(plaintext: string): string {
  if (!plaintext) return "";
  const key = getEncryptionKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function commsDecryptToken(ciphertext: string): string {
  if (!ciphertext) return "";
  const key = getEncryptionKey();
  if (!key) return ciphertext;
  try {
    const buf = Buffer.from(ciphertext, "base64");
    if (buf.length < IV_LENGTH + TAG_LENGTH) return ciphertext;
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return ciphertext;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/comms-crypto.test.ts --no-cache`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-crypto.ts src/__tests__/comms-crypto.test.ts
git commit -m "feat(comms): add AES-256-GCM token encryption"
```

---

### Task 3: Auth Helper — `getActualCommsUser()`

**Files:**
- Create: `src/lib/comms-auth.ts`
- Test: `src/__tests__/comms-auth.test.ts`

This is the dedicated actual-session-user resolver. It ignores impersonation and returns a 403-like signal when impersonation is active, so Comms never touches another user's Gmail tokens.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/comms-auth.test.ts`:

```typescript
import { getActualCommsUser } from "@/lib/comms-auth";

// Mock auth() and getUserByEmail
jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));
jest.mock("@/lib/db", () => ({
  getUserByEmail: jest.fn(),
}));

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockGetUser = getUserByEmail as jest.MockedFunction<typeof getUserByEmail>;

describe("getActualCommsUser", () => {
  afterEach(() => jest.resetAllMocks());

  test("returns null if no session", async () => {
    mockAuth.mockResolvedValue(null as any);
    const result = await getActualCommsUser();
    expect(result).toEqual({ user: null, blocked: false });
  });

  test("returns user when not impersonating", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "zach@photonbrothers.com" },
    } as any);
    mockGetUser.mockResolvedValue({
      id: "cuid_123",
      email: "zach@photonbrothers.com",
      name: "Zach",
      role: "ADMIN",
      impersonatingUserId: null,
    } as any);
    const result = await getActualCommsUser();
    expect(result.user?.id).toBe("cuid_123");
    expect(result.blocked).toBe(false);
  });

  test("returns blocked=true when admin is impersonating", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "zach@photonbrothers.com" },
    } as any);
    mockGetUser.mockResolvedValue({
      id: "cuid_123",
      email: "zach@photonbrothers.com",
      name: "Zach",
      role: "ADMIN",
      impersonatingUserId: "cuid_456",
    } as any);
    const result = await getActualCommsUser();
    expect(result.blocked).toBe(true);
    expect(result.user).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/comms-auth.test.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/comms-auth.ts`:

```typescript
/**
 * Comms-specific auth resolver.
 *
 * Unlike getCurrentUser(), this NEVER resolves to the impersonated user.
 * Comms routes handle personal Gmail/Chat tokens — impersonation would
 * route API calls through another user's inbox.
 */

import { auth } from "@/auth";
import { getUserByEmail } from "./db";
import { normalizeRole, UserRole } from "./role-permissions";

export interface CommsUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface CommsAuthResult {
  user: CommsUser | null;
  blocked: boolean; // true = impersonation active, Comms unavailable
}

export async function getActualCommsUser(): Promise<CommsAuthResult> {
  const session = await auth();

  if (!session?.user?.email) {
    return { user: null, blocked: false };
  }

  const dbUser = await getUserByEmail(session.user.email);
  if (!dbUser) {
    return { user: null, blocked: false };
  }

  // Block Comms entirely while impersonating
  if (dbUser.impersonatingUserId) {
    return { user: null, blocked: true };
  }

  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? undefined,
      role: normalizeRole(dbUser.role as UserRole),
    },
    blocked: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/comms-auth.test.ts --no-cache`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-auth.ts src/__tests__/comms-auth.test.ts
git commit -m "feat(comms): add getActualCommsUser() — ignores impersonation, blocks with 403"
```

---

### Task 4: Token Lifecycle — `getValidCommsAccessToken()`

**Files:**
- Create: `src/lib/comms-token.ts`
- Test: `src/__tests__/comms-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/comms-token.test.ts`:

```typescript
import { getValidCommsAccessToken } from "@/lib/comms-token";

jest.mock("@/lib/db", () => ({
  prisma: {
    commsGmailToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));
jest.mock("@/lib/comms-crypto", () => ({
  commsEncryptToken: jest.fn((v: string) => `enc_${v}`),
  commsDecryptToken: jest.fn((v: string) => v.replace("enc_", "")),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { prisma } from "@/lib/db";

describe("getValidCommsAccessToken", () => {
  afterEach(() => jest.resetAllMocks());

  test("returns cached token when not expired", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      gmailAccessToken: "enc_valid-token",
      gmailRefreshToken: "enc_refresh-token",
      gmailTokenExpiry: BigInt(Date.now() + 600_000), // 10 min from now
    });

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ accessToken: "valid-token" });
    expect(mockFetch).not.toHaveBeenCalled(); // no refresh needed
  });

  test("refreshes expired token", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      gmailAccessToken: "enc_expired-token",
      gmailRefreshToken: "enc_my-refresh-token",
      gmailTokenExpiry: BigInt(Date.now() - 1000), // expired
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    });
    (prisma.commsGmailToken.update as jest.Mock).mockResolvedValue({});

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ accessToken: "new-access-token" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("returns disconnected on invalid_grant", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      userId: "user-123",
      gmailAccessToken: "enc_expired-token",
      gmailRefreshToken: "enc_dead-refresh",
      gmailTokenExpiry: BigInt(Date.now() - 1000),
    });
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });
    (prisma.commsGmailToken.delete as jest.Mock).mockResolvedValue({});

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ disconnected: true });
  });

  test("returns disconnected when no token exists", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ disconnected: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/comms-token.test.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/comms-token.ts`:

```typescript
/**
 * Comms token lifecycle management.
 *
 * Handles access token caching, refresh, and invalid_grant detection.
 * See spec: "Token Lifecycle & Refresh" section.
 */

import { prisma } from "./db";
import { commsEncryptToken, commsDecryptToken } from "./comms-crypto";

const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenResult =
  | { accessToken: string; disconnected?: never }
  | { disconnected: true; accessToken?: never };

export async function getValidCommsAccessToken(
  userId: string
): Promise<TokenResult> {
  const row = await prisma.commsGmailToken.findUnique({
    where: { userId },
  });

  if (!row) return { disconnected: true };

  const accessToken = commsDecryptToken(row.gmailAccessToken);
  const refreshToken = commsDecryptToken(row.gmailRefreshToken);
  const expiresAt = Number(row.gmailTokenExpiry);

  // Return cached token if not expired (with buffer)
  if (accessToken && expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    return { accessToken };
  }

  // Refresh the token
  if (!refreshToken) return { disconnected: true };

  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    if (body.error === "invalid_grant") {
      // Refresh token is dead — clear tokens, signal disconnect
      await prisma.commsGmailToken.delete({ where: { userId } }).catch(() => {});
      return { disconnected: true };
    }
    throw new Error(`Token refresh failed: ${resp.status} ${body.error || ""}`);
  }

  const data = await resp.json();
  const newAccessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  const newExpiry = BigInt(Date.now() + expiresIn * 1000);

  await prisma.commsGmailToken.update({
    where: { id: row.id },
    data: {
      gmailAccessToken: commsEncryptToken(newAccessToken),
      gmailTokenExpiry: newExpiry,
      // Update refresh token if Google issued a new one
      ...(data.refresh_token
        ? { gmailRefreshToken: commsEncryptToken(data.refresh_token) }
        : {}),
    },
  });

  return { accessToken: newAccessToken };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/comms-token.test.ts --no-cache`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-token.ts src/__tests__/comms-token.test.ts
git commit -m "feat(comms): add token lifecycle with refresh and invalid_grant detection"
```

---

### Task 5: OAuth Connect Flow — CSRF-Protected

**Files:**
- Create: `src/app/api/comms/connect/route.ts`
- Create: `src/app/api/comms/connect/callback/route.ts`
- Create: `src/app/api/comms/status/route.ts`

- [ ] **Step 1: Create the connect initiation route**

Create `src/app/api/comms/connect/route.ts`:

```typescript
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { commsDecryptToken } from "@/lib/comms-crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.users.readstate.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
].join(" ");

function signState(payload: string): string {
  const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

/** GET: Initiate OAuth flow with CSRF-signed state */
export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const redirectUri = `${process.env.AUTH_URL || "http://localhost:3000"}/api/comms/connect/callback`;

  // CSRF state: userId + nonce + expiry, HMAC-signed
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  const statePayload = `${user.id}:${nonce}:${expiresAt}`;
  const signature = signState(statePayload);
  const state = `${statePayload}:${signature}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return NextResponse.json({ authUrl: authUrl.toString() });
}

/** DELETE: Disconnect Gmail — revoke token and delete records */
export async function DELETE() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = await prisma.commsGmailToken.findUnique({
    where: { userId: user.id },
  });

  if (token) {
    // Revoke with Google
    const refreshToken = commsDecryptToken(token.gmailRefreshToken);
    if (refreshToken) {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: "POST" }
      ).catch(() => {});
    }

    await prisma.commsGmailToken.delete({ where: { userId: user.id } });
  }

  await prisma.commsUserState.delete({ where: { userId: user.id } }).catch(() => {});

  return NextResponse.json({ disconnected: true });
}
```

- [ ] **Step 2: Create the OAuth callback route**

Create `src/app/api/comms/connect/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { commsEncryptToken } from "@/lib/comms-crypto";

function verifyState(state: string, expectedUserId: string): boolean {
  try {
    const parts = state.split(":");
    if (parts.length !== 4) return false;
    const [userId, nonce, expiresAtStr, signature] = parts;

    // Check expiry
    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) return false;

    // Check user ID matches session
    if (userId !== expectedUserId) return false;

    // Validate hex format before Buffer.from
    if (!/^[0-9a-f]+$/i.test(signature)) return false;

    // Verify HMAC signature
    const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
    const payload = `${userId}:${nonce}:${expiresAtStr}`;
    const expectedSig = crypto
      .createHmac("sha256", key)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSig, "hex")
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked || !user) {
    return NextResponse.redirect(new URL("/dashboards/comms?error=auth", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";

  if (!code || !verifyState(state, user.id)) {
    return NextResponse.redirect(
      new URL("/dashboards/comms?error=invalid_state", req.url)
    );
  }

  // Exchange code for tokens
  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";
  const redirectUri = `${process.env.AUTH_URL || "http://localhost:3000"}/api/comms/connect/callback`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    return NextResponse.redirect(
      new URL("/dashboards/comms?error=token_exchange", req.url)
    );
  }

  const data = await tokenResp.json();
  const expiresIn = (data.expires_in as number) || 3600;

  // Upsert token record
  await prisma.commsGmailToken.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      gmailAccessToken: commsEncryptToken(data.access_token),
      gmailRefreshToken: commsEncryptToken(data.refresh_token || ""),
      gmailTokenExpiry: BigInt(Date.now() + expiresIn * 1000),
      chatEnabled: true,
      scopes: data.scope || "",
    },
    update: {
      gmailAccessToken: commsEncryptToken(data.access_token),
      gmailRefreshToken: commsEncryptToken(data.refresh_token || ""),
      gmailTokenExpiry: BigInt(Date.now() + expiresIn * 1000),
      chatEnabled: true,
      scopes: data.scope || "",
    },
  });

  // Ensure CommsUserState exists
  await prisma.commsUserState.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return NextResponse.redirect(new URL("/dashboards/comms?connected=true", req.url));
}
```

- [ ] **Step 3: Create the status route**

Create `src/app/api/comms/status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json({ connected: false, impersonating: true });
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = await prisma.commsGmailToken.findUnique({
    where: { userId: user.id },
    select: { chatEnabled: true, scopes: true, createdAt: true },
  });

  return NextResponse.json({
    connected: !!token,
    chatEnabled: token?.chatEnabled ?? false,
    connectedAt: token?.createdAt ?? null,
  });
}
```

- [ ] **Step 4: Smoke test the routes compile**

Run: `npx tsc --noEmit`
Expected: No type errors in the new files. (Runtime testing requires env vars and Google OAuth setup — deferred to integration testing.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/comms/connect/ src/app/api/comms/status/
git commit -m "feat(comms): add OAuth connect/callback/disconnect/status routes with CSRF protection"
```

---

### Task 6: Query Keys & Integration Wiring

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `src/lib/role-permissions.ts`
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/components/GlobalSearch.tsx`

- [ ] **Step 1: Add comms query keys**

In `src/lib/query-keys.ts`, add to the `queryKeys` object:

```typescript
  comms: {
    root: ["comms"] as const,
    messages: (filters?: Record<string, string>) =>
      [...queryKeys.comms.root, "messages", filters] as const,
    chat: (filters?: Record<string, string>) =>
      [...queryKeys.comms.root, "chat", filters] as const,
    status: () => [...queryKeys.comms.root, "status"] as const,
    drafts: () => [...queryKeys.comms.root, "drafts"] as const,
    preferences: (key?: string) =>
      [...queryKeys.comms.root, "preferences", key] as const,
  },
```

- [ ] **Step 2: Add Comms routes to role-permissions**

In `src/lib/role-permissions.ts`, add `/dashboards/comms` and `/api/comms` to the route access lists for `ADMIN` and `EXECUTIVE`. These roles already have wildcard (`"*"`) access, but adding explicit entries documents which roles should get Comms when non-wildcard roles are added later:

```typescript
// Inside ROUTE_ACCESS or equivalent, add:
"/dashboards/comms": ["ADMIN", "EXECUTIVE"],
"/api/comms": ["ADMIN", "EXECUTIVE"],
```

- [ ] **Step 3: Add Comms card to Operations suite**

In `src/app/suites/operations/page.tsx`, add to the `LINKS` array:

```typescript
  {
    href: "/dashboards/comms",
    title: "Comms",
    description: "Gmail, Google Chat, and HubSpot messages with AI-assisted drafting.",
    tag: "COMMS",
    section: "Communications",
  },
```

- [ ] **Step 4: Add to DashboardShell SUITE_MAP**

In `src/components/DashboardShell.tsx`, add to the `SUITE_MAP` object:

```typescript
  "/dashboards/comms": { href: "/suites/operations", label: "Operations" },
```

- [ ] **Step 5: Add to GlobalSearch**

In `src/components/GlobalSearch.tsx`, add to the `DASHBOARD_LINKS` array:

```typescript
  { name: "Comms", path: "/dashboards/comms", description: "Gmail, Chat, and HubSpot unified inbox" },
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/query-keys.ts src/lib/role-permissions.ts src/app/suites/operations/page.tsx src/components/DashboardShell.tsx src/components/GlobalSearch.tsx
git commit -m "feat(comms): wire up query keys, role permissions, Operations card, breadcrumbs, and global search"
```

---

## Chunk 2: Gmail & Chat API Layer

### Task 7: Gmail Fetch — `comms-gmail.ts`

**Files:**
- Create: `src/lib/comms-gmail.ts`

This is the core Gmail API layer. Uses raw `fetch` matching the `google-calendar.ts` pattern. Each call goes through `getValidCommsAccessToken()` for automatic token refresh.

- [ ] **Step 1: Create Gmail fetch helpers**

Create `src/lib/comms-gmail.ts`:

```typescript
/**
 * Gmail REST API helpers for the Comms dashboard.
 *
 * Uses raw fetch (no googleapis SDK) matching google-calendar.ts pattern.
 * Every call resolves a valid access token via getValidCommsAccessToken().
 */

import { getValidCommsAccessToken } from "./comms-token";
import { prisma } from "./db";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailApiOptions {
  userId: string;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

export type CommsMessage = {
  id: string;
  threadId: string;
  source: "gmail" | "hubspot";
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
  hubspotDealId?: string;
  hubspotDealUrl?: string;
};

type GmailResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

async function gmailFetch<T>(opts: GmailApiOptions): Promise<GmailResult<T>> {
  const tokenResult = await getValidCommsAccessToken(opts.userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const url = new URL(`${GMAIL_BASE}${opts.path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (resp.status === 401) {
    // Retry once with fresh token (access token may have just expired)
    const retryToken = await getValidCommsAccessToken(opts.userId);
    if ("disconnected" in retryToken) return { disconnected: true };

    const retryResp = await fetch(url.toString(), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${retryToken.accessToken}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (!retryResp.ok) {
      return { error: `Gmail API ${retryResp.status}` };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Gmail API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

/** Check if inbox has changed since last historyId. Returns null if no changes. */
export async function checkGmailChanges(
  userId: string,
  historyId: string
): Promise<{ changed: boolean; newHistoryId?: string; disconnected?: true }> {
  if (!historyId) return { changed: true };

  const result = await gmailFetch<{ history?: unknown[]; historyId: string }>({
    userId,
    path: "/history",
    params: { startHistoryId: historyId, maxResults: "1" },
  });

  if ("disconnected" in result) return { disconnected: true };
  if ("error" in result) {
    // 404 = historyId expired, treat as changed
    if (result.error.includes("404")) return { changed: true };
    return { changed: true }; // fail open — fetch anyway
  }

  const hasChanges = (result.data.history?.length ?? 0) > 0;
  return {
    changed: hasChanges,
    newHistoryId: result.data.historyId,
  };
}

function extractHeader(
  headers: Array<{ name: string; value: string }>,
  name: string
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractEmailAddress(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return match ? match[1] : header;
}

function parseGmailMessage(msg: Record<string, any>): CommsMessage {
  const headers: Array<{ name: string; value: string }> =
    msg.payload?.headers || [];
  const from = extractHeader(headers, "From");
  const fromEmail = extractEmailAddress(from);
  const labelIds: string[] = msg.labelIds || [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    source: "gmail", // categorize() upgrades to "hubspot" later
    from,
    fromEmail,
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    snippet: msg.snippet || "",
    date: extractHeader(headers, "Date") ||
      (msg.internalDate
        ? new Date(parseInt(msg.internalDate)).toISOString()
        : new Date().toISOString()),
    isUnread: labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    labelIds,
  };
}

/** Fetch a full page of Gmail messages. */
export async function fetchGmailPage(
  userId: string,
  options: {
    pageToken?: string;
    maxResults?: number;
    query?: string;
  } = {}
): Promise<GmailResult<{
  messages: CommsMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
  historyId: string;
}>> {
  const maxResults = options.maxResults || 50;
  const params: Record<string, string> = {
    maxResults: String(maxResults),
    q: options.query || "in:inbox",
  };
  if (options.pageToken) params.pageToken = options.pageToken;

  // Step 1: Get message IDs
  const listResult = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>({ userId, path: "/messages", params });

  if ("disconnected" in listResult) return { disconnected: true };
  if ("error" in listResult) return { error: listResult.error };

  const ids = listResult.data.messages || [];
  if (ids.length === 0) {
    // Get current historyId from profile
    const profile = await gmailFetch<{ historyId: string }>({
      userId,
      path: "/profile",
    });
    return {
      data: {
        messages: [],
        nextPageToken: listResult.data.nextPageToken,
        resultSizeEstimate: 0,
        historyId: "data" in profile ? profile.data.historyId : "",
      },
    };
  }

  // Step 2: Batch-fetch message details
  const batchSize = 20;
  const messages: CommsMessage[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((m) =>
        gmailFetch<Record<string, any>>({
          userId,
          path: `/messages/${m.id}`,
          params: { format: "metadata", metadataHeaders: "From,To,Subject,Date" },
        })
      )
    );
    for (const r of batchResults) {
      if ("data" in r) messages.push(parseGmailMessage(r.data));
    }
  }

  // Get historyId from profile
  const profile = await gmailFetch<{ historyId: string }>({
    userId,
    path: "/profile",
  });

  return {
    data: {
      messages,
      nextPageToken: listResult.data.nextPageToken,
      resultSizeEstimate: listResult.data.resultSizeEstimate || messages.length,
      historyId: "data" in profile ? profile.data.historyId : "",
    },
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/comms-gmail.ts
git commit -m "feat(comms): add Gmail REST API fetch layer with token refresh and 401 retry"
```

---

### Task 8: Chat Fetch — `comms-chat.ts`

**Files:**
- Create: `src/lib/comms-chat.ts`

Concrete Chat bounds: max **30 spaces**, **20 messages per space**, sorted by `createTime` descending. Messages interleaved with Gmail by timestamp.

- [ ] **Step 1: Create Chat fetch helpers**

Create `src/lib/comms-chat.ts`:

```typescript
/**
 * Google Chat REST API helpers for the Comms dashboard.
 *
 * Bounds: max 30 spaces, 20 messages per space.
 * Returns a bounded recent window every time (no delta filter).
 * chatLastSyncAt used only for no-change fast path.
 */

import { getValidCommsAccessToken } from "./comms-token";

const CHAT_BASE = "https://chat.googleapis.com/v1";
const MAX_SPACES = 30;
const MESSAGES_PER_SPACE = 20;

export type CommsChatMessage = {
  id: string;
  spaceId: string;
  spaceName: string;
  source: "chat";
  sender: string;
  senderEmail: string;
  text: string;
  date: string; // ISO
  threadId?: string;
};

type ChatResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

async function chatFetch<T>(
  userId: string,
  path: string,
  params?: Record<string, string>
): Promise<ChatResult<T>> {
  const tokenResult = await getValidCommsAccessToken(userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const url = new URL(`${CHAT_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
  });

  if (resp.status === 401) {
    // Retry once with fresh token (consistent with gmailFetch pattern)
    const retryToken = await getValidCommsAccessToken(userId);
    if ("disconnected" in retryToken) return { disconnected: true };
    const retryResp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${retryToken.accessToken}` },
    });
    if (!retryResp.ok) {
      const text = await retryResp.text().catch(() => "");
      return { error: `Chat API ${retryResp.status}: ${text}`.trim() };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Chat API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

interface ChatSpace {
  name: string; // "spaces/AAAA"
  displayName: string;
  lastActiveTime?: string;
}

interface ChatMessageRaw {
  name: string; // "spaces/AAAA/messages/BBBB"
  sender?: { name?: string; displayName?: string; email?: string };
  text?: string;
  createTime?: string;
  thread?: { name?: string };
}

/** Fetch bounded recent Chat messages across all spaces. */
export async function fetchChatMessages(
  userId: string,
  options: {
    chatLastSyncAt?: Date | null;
  } = {}
): Promise<ChatResult<{
  messages: CommsChatMessage[];
  latestActivityTime: Date | null;
  spaceCount: number;
}>> {
  // Step 1: List user's spaces
  const spacesResult = await chatFetch<{
    spaces?: ChatSpace[];
    nextPageToken?: string;
  }>(userId, "/spaces", { pageSize: String(MAX_SPACES) });

  if ("disconnected" in spacesResult) return { disconnected: true };
  if ("error" in spacesResult) return { error: spacesResult.error };

  const spaces = (spacesResult.data.spaces || []).slice(0, MAX_SPACES);

  if (spaces.length === 0) {
    return { data: { messages: [], latestActivityTime: null, spaceCount: 0 } };
  }

  // No-change fast path: if all spaces have lastActiveTime <= chatLastSyncAt, skip
  if (options.chatLastSyncAt) {
    const syncTime = options.chatLastSyncAt.getTime();
    const anyNew = spaces.some((s) => {
      if (!s.lastActiveTime) return true;
      return new Date(s.lastActiveTime).getTime() > syncTime;
    });
    if (!anyNew) {
      return {
        data: {
          messages: [],
          latestActivityTime: options.chatLastSyncAt,
          spaceCount: spaces.length,
        },
      };
    }
  }

  // Step 2: Fetch latest messages per space (bounded window, no delta filter)
  const allMessages: CommsChatMessage[] = [];
  let latestTime: Date | null = null;

  // Fetch in parallel batches of 5 to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < spaces.length; i += batchSize) {
    const batch = spaces.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((space) =>
        chatFetch<{ messages?: ChatMessageRaw[] }>(
          userId,
          `/${space.name}/messages`,
          {
            pageSize: String(MESSAGES_PER_SPACE),
            orderBy: "createTime desc",
          }
        ).then((r) => ({ space, result: r }))
      )
    );

    for (const { space, result } of results) {
      if ("data" in result && result.data.messages) {
        for (const msg of result.data.messages) {
          const msgDate = msg.createTime
            ? new Date(msg.createTime)
            : new Date();

          if (!latestTime || msgDate > latestTime) {
            latestTime = msgDate;
          }

          allMessages.push({
            id: msg.name || "",
            spaceId: space.name,
            spaceName: space.displayName || space.name,
            source: "chat",
            sender: msg.sender?.displayName || "Unknown",
            senderEmail: msg.sender?.email || "",
            text: msg.text || "",
            date: msgDate.toISOString(),
            threadId: msg.thread?.name,
          });
        }
      }
    }
  }

  // Sort by date descending
  allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    data: {
      messages: allMessages,
      latestActivityTime: latestTime,
      spaceCount: spaces.length,
    },
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/comms-chat.ts
git commit -m "feat(comms): add Chat API layer — max 30 spaces, 20 msgs/space, bounded window"
```

---

### Task 9: Message Categorization — `comms-categorize.ts`

**Files:**
- Create: `src/lib/comms-categorize.ts`
- Test: `src/__tests__/comms-categorize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/comms-categorize.test.ts`:

```typescript
import { categorizeMessage, CommsCategory } from "@/lib/comms-categorize";
import type { CommsMessage } from "@/lib/comms-gmail";

function makeMsg(overrides: Partial<CommsMessage>): CommsMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    source: "gmail",
    from: "Test User <test@example.com>",
    fromEmail: "test@example.com",
    to: "zach@photonbrothers.com",
    subject: "Hello",
    snippet: "Test message",
    date: new Date().toISOString(),
    isUnread: false,
    isStarred: false,
    labelIds: [],
    ...overrides,
  };
}

describe("categorizeMessage", () => {
  test("tags HubSpot notification emails as hubspot source", () => {
    const msg = makeMsg({ fromEmail: "notifications@hubspot.com" });
    const result = categorizeMessage(msg, "21710069");
    expect(result.source).toBe("hubspot");
  });

  test("detects deal stage change in subject", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      subject: "Deal moved to Closed Won",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.category).toBe("stage_change");
  });

  test("detects @mention in snippet", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      snippet: "@Zach can you confirm the install date?",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.category).toBe("mention");
  });

  test("extracts deal URL from HubSpot email", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      snippet: "View deal: https://app.hubspot.com/contacts/21710069/deal/12345",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.hubspotDealId).toBe("12345");
  });

  test("leaves non-HubSpot emails as gmail source", () => {
    const msg = makeMsg({ fromEmail: "friend@gmail.com" });
    const result = categorizeMessage(msg, "21710069");
    expect(result.source).toBe("gmail");
    expect(result.category).toBe("general");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/comms-categorize.test.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/comms-categorize.ts`:

```typescript
/**
 * Message categorization for the Comms dashboard.
 *
 * HubSpot messages are Gmail emails from HubSpot notification addresses,
 * categorized by sender domain and subject/snippet pattern matching.
 */

import type { CommsMessage } from "./comms-gmail";

export type CommsCategory =
  | "stage_change"
  | "mention"
  | "task"
  | "comment"
  | "general";

export interface CategorizedMessage extends CommsMessage {
  category: CommsCategory;
}

const HUBSPOT_DOMAINS = [
  "hubspot.com",
  "hs-inbox.com",
  "hubspot.net",
  "inbound.hubspot.com",
];

function isHubSpotEmail(fromEmail: string): boolean {
  const domain = fromEmail.split("@")[1]?.toLowerCase() || "";
  return HUBSPOT_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`)
  );
}

function detectCategory(subject: string, snippet: string): CommsCategory {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/deal (moved|stage|changed|updated)/i.test(text)) return "stage_change";
  if (/@\w/.test(snippet)) return "mention";
  if (/task (assigned|created|due|completed)/i.test(text)) return "task";
  if (/comment|replied|noted/i.test(text)) return "comment";
  return "general";
}

function extractDealId(
  snippet: string,
  portalId: string
): string | undefined {
  // Match HubSpot deal URLs: app.hubspot.com/contacts/{portalId}/deal/{dealId}
  const pattern = new RegExp(
    `app\\.hubspot\\.com/contacts/${portalId}/deal/(\\d+)`
  );
  const match = snippet.match(pattern);
  return match?.[1];
}

export function categorizeMessage(
  msg: CommsMessage,
  hubspotPortalId: string
): CategorizedMessage {
  if (!isHubSpotEmail(msg.fromEmail)) {
    return { ...msg, category: "general" };
  }

  const category = detectCategory(msg.subject, msg.snippet);
  const dealId = extractDealId(msg.snippet, hubspotPortalId);

  return {
    ...msg,
    source: "hubspot",
    category,
    ...(dealId
      ? {
          hubspotDealId: dealId,
          hubspotDealUrl: `https://app.hubspot.com/contacts/${hubspotPortalId}/deal/${dealId}`,
        }
      : {}),
  };
}

/** Categorize a batch of messages. */
export function categorizeMessages(
  messages: CommsMessage[],
  hubspotPortalId: string
): CategorizedMessage[] {
  return messages.map((m) => categorizeMessage(m, hubspotPortalId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/comms-categorize.test.ts --no-cache`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-categorize.ts src/__tests__/comms-categorize.test.ts
git commit -m "feat(comms): add message categorization — HubSpot detection, deal link extraction"
```

---

### Task 10: Messages API Route — Full-Page Fetch

**Files:**
- Create: `src/app/api/comms/messages/route.ts`

This is the main inbox API. Returns a unified page of Gmail + Chat messages, interleaved by timestamp.

- [ ] **Step 1: Create the messages route**

Create `src/app/api/comms/messages/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { checkGmailChanges, fetchGmailPage, CommsMessage } from "@/lib/comms-gmail";
import { fetchChatMessages, CommsChatMessage } from "@/lib/comms-chat";
import { categorizeMessages, CategorizedMessage } from "@/lib/comms-categorize";

type UnifiedMessage = CategorizedMessage | (CommsChatMessage & { category: "general" });

export async function GET(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const source = params.get("source") || "all"; // all | gmail | chat | hubspot
  const page = params.get("page") || undefined;
  const chatPage = params.get("chatPage") || undefined;
  const query = params.get("q") || undefined;

  // Read user state for no-change fast path
  const state = await prisma.commsUserState.findUnique({
    where: { userId: user.id },
  });

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const includeGmail = source === "all" || source === "gmail" || source === "hubspot";
  const includeChat = source === "all" || source === "chat";

  // --- Gmail ---
  let gmailMessages: CategorizedMessage[] = [];
  let gmailNextPage: string | undefined;
  let unchanged = false;

  if (includeGmail) {
    // No-change fast path
    if (state?.gmailHistoryId && !page && !query) {
      const changes = await checkGmailChanges(user.id, state.gmailHistoryId);
      if ("disconnected" in changes && changes.disconnected) {
        return NextResponse.json({ disconnected: true });
      }
      if (!changes.changed) {
        unchanged = true;
      }
    }

    if (!unchanged) {
      const gmailResult = await fetchGmailPage(user.id, {
        pageToken: page,
        query: query ? `in:inbox ${query}` : "in:inbox",
      });

      if ("disconnected" in gmailResult) {
        return NextResponse.json({ disconnected: true });
      }
      if ("error" in gmailResult) {
        return NextResponse.json({ error: gmailResult.error }, { status: 502 });
      }

      gmailMessages = categorizeMessages(gmailResult.data.messages, portalId);
      gmailNextPage = gmailResult.data.nextPageToken;

      // Update historyId
      if (gmailResult.data.historyId) {
        await prisma.commsUserState.upsert({
          where: { userId: user.id },
          create: { userId: user.id, gmailHistoryId: gmailResult.data.historyId },
          update: { gmailHistoryId: gmailResult.data.historyId },
        });
      }
    }
  }

  // --- Chat ---
  let chatMessages: CommsChatMessage[] = [];
  let chatSpaceCount = 0;

  if (includeChat && !unchanged) {
    const chatResult = await fetchChatMessages(user.id, {
      chatLastSyncAt: state?.chatLastSyncAt,
    });

    if ("data" in chatResult) {
      chatMessages = chatResult.data.messages;
      chatSpaceCount = chatResult.data.spaceCount;

      if (chatResult.data.latestActivityTime) {
        await prisma.commsUserState.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            chatLastSyncAt: chatResult.data.latestActivityTime,
          },
          update: {
            chatLastSyncAt: chatResult.data.latestActivityTime,
          },
        });
      }
    }
    // Chat errors are non-fatal — just skip Chat messages
  }

  // If both Gmail unchanged and Chat returned empty (no-change fast path)
  if (unchanged && chatMessages.length === 0) {
    return NextResponse.json({ unchanged: true });
  }

  // --- Merge & filter ---
  // Filter by source if requested
  let filtered: CategorizedMessage[] = gmailMessages;
  if (source === "hubspot") {
    filtered = gmailMessages.filter((m) => m.source === "hubspot");
  }

  // Interleave Gmail + Chat by timestamp
  const unified: UnifiedMessage[] = [
    ...filtered,
    ...chatMessages.map((c) => ({ ...c, category: "general" as const })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Compute focus analytics
  const unreadCount = gmailMessages.filter((m) => m.isUnread).length;
  const senderCounts = new Map<string, number>();
  for (const m of gmailMessages) {
    senderCounts.set(m.fromEmail, (senderCounts.get(m.fromEmail) || 0) + 1);
  }
  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([email, count]) => ({ email, count }));

  return NextResponse.json({
    messages: unified,
    analytics: {
      unreadCount,
      totalMessages: unified.length,
      topSenders,
      chatSpaceCount,
    },
    pagination: {
      gmailNextPage: gmailNextPage || null,
    },
    lastUpdated: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/comms/messages/route.ts
git commit -m "feat(comms): add /api/comms/messages — full-page fetch with Gmail+Chat merge"
```

---

### Task 11: Chat API Route

**Files:**
- Create: `src/app/api/comms/chat/route.ts`

Standalone Chat endpoint for when the user filters to Chat-only source.

- [ ] **Step 1: Create the chat route**

Create `src/app/api/comms/chat/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { fetchChatMessages } from "@/lib/comms-chat";
import { prisma } from "@/lib/db";

export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const state = await prisma.commsUserState.findUnique({
    where: { userId: user.id },
  });

  const result = await fetchChatMessages(user.id, {
    chatLastSyncAt: state?.chatLastSyncAt,
  });

  if ("disconnected" in result) {
    return NextResponse.json({ disconnected: true });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    messages: result.data.messages,
    spaceCount: result.data.spaceCount,
    lastUpdated: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/comms/chat/route.ts
git commit -m "feat(comms): add /api/comms/chat standalone route"
```

---

## Chunk 3: Draft Management & AI

### Task 12: Email Compose Helpers — `comms-email-compose.ts`

**Files:**
- Create: `src/lib/comms-email-compose.ts`

- [ ] **Step 1: Create compose helpers**

Create `src/lib/comms-email-compose.ts`:

```typescript
/**
 * Gmail draft create/update/send helpers.
 * Uses raw fetch against Gmail REST API.
 */

import { getValidCommsAccessToken } from "./comms-token";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type DraftResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

function buildRawMimeMessage(opts: {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push("");
  lines.push(opts.body);

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

async function gmailDraftFetch<T>(
  userId: string,
  path: string,
  method: string,
  body?: Record<string, unknown>
): Promise<DraftResult<T>> {
  const tokenResult = await getValidCommsAccessToken(userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const resp = await fetch(`${GMAIL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (resp.status === 401) {
    // Retry once with fresh token
    const retryToken = await getValidCommsAccessToken(userId);
    if ("disconnected" in retryToken) return { disconnected: true };
    const retryResp = await fetch(`${GMAIL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${retryToken.accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!retryResp.ok) {
      const text = await retryResp.text().catch(() => "");
      return { error: `Gmail draft API ${retryResp.status}: ${text}`.trim() };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Gmail draft API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

export async function createGmailDraft(
  userId: string,
  opts: { to: string; cc?: string; subject: string; body: string; threadId?: string }
): Promise<DraftResult<{ draftId: string; messageId: string }>> {
  const raw = buildRawMimeMessage(opts);
  const result = await gmailDraftFetch<{
    id: string;
    message: { id: string };
  }>(userId, "/drafts", "POST", {
    message: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) },
  });

  if ("data" in result) {
    return {
      data: { draftId: result.data.id, messageId: result.data.message.id },
    };
  }
  return result;
}

export async function updateGmailDraft(
  userId: string,
  draftId: string,
  opts: { to: string; cc?: string; subject: string; body: string }
): Promise<DraftResult<{ draftId: string }>> {
  const raw = buildRawMimeMessage(opts);
  const result = await gmailDraftFetch<{ id: string }>(
    userId,
    `/drafts/${draftId}`,
    "PUT",
    { message: { raw } }
  );

  if ("data" in result) return { data: { draftId: result.data.id } };
  return result;
}

export async function sendGmailDraft(
  userId: string,
  draftId: string
): Promise<DraftResult<{ messageId: string; threadId: string }>> {
  // Gmail send endpoint is POST /gmail/v1/users/me/drafts/send with { id: draftId }
  const result = await gmailDraftFetch<{ id: string; threadId: string }>(
    userId,
    "/drafts/send",
    "POST",
    { id: draftId }
  );

  if ("data" in result) {
    return { data: { messageId: result.data.id, threadId: result.data.threadId } };
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/comms-email-compose.ts
git commit -m "feat(comms): add Gmail draft create/update/send helpers"
```

---

### Task 13: Draft API Routes

**Files:**
- Create: `src/app/api/comms/draft/route.ts`
- Create: `src/app/api/comms/draft/send/route.ts`

- [ ] **Step 1: Create draft route (POST create, PUT update)**

Create `src/app/api/comms/draft/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { createGmailDraft, updateGmailDraft } from "@/lib/comms-email-compose";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { to, cc, subject, body: draftBody, threadId } = body;

  if (!to || !subject) {
    return NextResponse.json({ error: "to and subject are required" }, { status: 400 });
  }

  const result = await createGmailDraft(user.id, { to, cc, subject, body: draftBody || "", threadId });

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}

export async function PUT(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { draftId, to, cc, subject, body: draftBody } = body;

  if (!draftId || !to || !subject) {
    return NextResponse.json({ error: "draftId, to, and subject are required" }, { status: 400 });
  }

  const result = await updateGmailDraft(user.id, draftId, { to, cc, subject, body: draftBody || "" });

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}
```

- [ ] **Step 2: Create send route**

Create `src/app/api/comms/draft/send/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { sendGmailDraft } from "@/lib/comms-email-compose";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { draftId } = await req.json();
  if (!draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const result = await sendGmailDraft(user.id, draftId);

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/comms/draft/
git commit -m "feat(comms): add draft create/update/send API routes"
```

---

### Task 14: AI Draft Generation — `comms-ai-draft.ts`

**Files:**
- Create: `src/lib/comms-ai-draft.ts`
- Create: `src/app/api/comms/ai-draft/route.ts`

- [ ] **Step 1: Create AI draft helper**

Create `src/lib/comms-ai-draft.ts`:

```typescript
/**
 * AI-assisted draft generation for Comms.
 * Claude primary, Gemini fallback.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface DraftContext {
  originalFrom: string;
  originalSubject: string;
  originalSnippet: string;
  threadSnippets?: string[];
  voiceProfile?: string; // "sales" | "ops" | "executive" | "casual"
  customInstructions?: string;
}

interface GeneratedDraft {
  body: string;
  provider: "claude" | "gemini" | "template";
}

async function generateWithClaude(
  context: DraftContext
): Promise<GeneratedDraft | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You are drafting a professional email reply for a solar operations company (Photon Brothers). Voice: ${context.voiceProfile || "professional"}. Be concise and direct. Do not include a subject line — only the email body.${context.customInstructions ? ` Additional instructions: ${context.customInstructions}` : ""}`;

  const threadContext = context.threadSnippets?.length
    ? `\n\nThread context:\n${context.threadSnippets.slice(0, 3).join("\n---\n")}`
    : "";

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Draft a reply to this email:\n\nFrom: ${context.originalFrom}\nSubject: ${context.originalSubject}\nBody: ${context.originalSnippet}${threadContext}`,
        },
      ],
    }),
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const text = data.content?.[0]?.text;
  if (!text) return null;

  return { body: text, provider: "claude" };
}

async function generateWithGemini(
  context: DraftContext
): Promise<GeneratedDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
  const prompt = `Draft a professional email reply for a solar operations company (Photon Brothers). Voice: ${context.voiceProfile || "professional"}.${context.customInstructions ? ` ${context.customInstructions}` : ""}\n\nOriginal email:\nFrom: ${context.originalFrom}\nSubject: ${context.originalSubject}\nBody: ${context.originalSnippet}\n\nWrite only the email body, no subject line.`;

  const resp = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!resp.ok) return null;

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  return { body: text, provider: "gemini" };
}

export async function generateAiDraft(
  context: DraftContext
): Promise<GeneratedDraft> {
  // Claude primary, Gemini fallback
  const claudeResult = await generateWithClaude(context);
  if (claudeResult) return claudeResult;

  const geminiResult = await generateWithGemini(context);
  if (geminiResult) return geminiResult;

  return {
    body: `Hi,\n\nThank you for your email regarding "${context.originalSubject}". I'll review and get back to you shortly.\n\nBest,`,
    provider: "template", // neither AI provider available
  };
}
```

- [ ] **Step 2: Create AI draft route**

Create `src/app/api/comms/ai-draft/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { generateAiDraft } from "@/lib/comms-ai-draft";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { originalFrom, originalSubject, originalSnippet, threadSnippets, voiceProfile, customInstructions } = body;

  if (!originalFrom || !originalSubject) {
    return NextResponse.json({ error: "originalFrom and originalSubject are required" }, { status: 400 });
  }

  const result = await generateAiDraft({
    originalFrom,
    originalSubject,
    originalSnippet: originalSnippet || "",
    threadSnippets,
    voiceProfile,
    customInstructions,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/comms-ai-draft.ts src/app/api/comms/ai-draft/route.ts
git commit -m "feat(comms): add AI draft generation — Claude primary, Gemini fallback"
```

---

### Task 15: Feedback & Preferences Routes

**Files:**
- Create: `src/app/api/comms/feedback/route.ts`
- Create: `src/app/api/comms/preferences/route.ts`

- [ ] **Step 1: Create feedback route**

Create `src/app/api/comms/feedback/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { rating, draftBody, originalSubject, provider } = await req.json();

  if (!rating || !["good", "needs_work"].includes(rating)) {
    return NextResponse.json({ error: "rating must be 'good' or 'needs_work'" }, { status: 400 });
  }

  await prisma.commsAiMemory.create({
    data: {
      userId: user.id,
      kind: "feedback",
      data: { rating, draftBody, originalSubject, provider, timestamp: new Date().toISOString() },
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create preferences route**

Create `src/app/api/comms/preferences/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key") || "";
  const kind = req.nextUrl.searchParams.get("kind") || "sender_pref";

  const prefs = await prisma.commsAiMemory.findMany({
    where: { userId: user.id, kind, ...(key ? { key } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ preferences: prefs });
}

export async function PUT(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { kind, key, data } = await req.json();

  if (!kind || !key || !data) {
    return NextResponse.json({ error: "kind, key, and data are required" }, { status: 400 });
  }

  // Upsert: find existing pref for this user/kind/key, or create
  const existing = await prisma.commsAiMemory.findFirst({
    where: { userId: user.id, kind, key },
  });

  if (existing) {
    await prisma.commsAiMemory.update({
      where: { id: existing.id },
      data: { data },
    });
  } else {
    await prisma.commsAiMemory.create({
      data: { userId: user.id, kind, key, data },
    });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/comms/feedback/ src/app/api/comms/preferences/
git commit -m "feat(comms): add feedback and preferences API routes"
```

---

### Task 16: Bulk Actions Route

**Files:**
- Create: `src/app/api/comms/bulk/route.ts`

- [ ] **Step 1: Create bulk route**

Create `src/app/api/comms/bulk/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { getValidCommsAccessToken } from "@/lib/comms-token";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { action, messageIds } = await req.json();

  if (!action || !Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "action and messageIds[] are required" }, { status: 400 });
  }

  const tokenResult = await getValidCommsAccessToken(user.id);
  if ("disconnected" in tokenResult) return NextResponse.json({ disconnected: true });

  // Gmail batchModify supports up to 1000 IDs
  const ids = messageIds.slice(0, 100); // practical limit per request

  let addLabelIds: string[] = [];
  let removeLabelIds: string[] = [];

  switch (action) {
    case "mark_read":
      removeLabelIds = ["UNREAD"];
      break;
    case "mark_unread":
      addLabelIds = ["UNREAD"];
      break;
    case "archive":
      removeLabelIds = ["INBOX"];
      break;
    case "star":
      addLabelIds = ["STARRED"];
      break;
    case "unstar":
      removeLabelIds = ["STARRED"];
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const resp = await fetch(`${GMAIL_BASE}/messages/batchModify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids, addLabelIds, removeLabelIds }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json({ error: `Bulk action failed: ${resp.status} ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/comms/bulk/route.ts
git commit -m "feat(comms): add bulk actions route — mark read, archive, star"
```

---

## Chunk 4: Frontend — Dashboard Page & Components

### Task 17: Connect Banner Component

**Files:**
- Create: `src/components/comms/CommsConnectBanner.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/comms/CommsConnectBanner.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  impersonating?: boolean;
}

export default function CommsConnectBanner({ impersonating }: Props) {
  const [loading, setLoading] = useState(false);

  if (impersonating) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          Comms Unavailable
        </h3>
        <p className="mt-1 text-sm text-muted">
          Comms is not available while impersonating another user. Exit
          impersonation to access your inbox.
        </p>
      </div>
    );
  }

  async function handleConnect() {
    setLoading(true);
    try {
      const resp = await fetch("/api/comms/connect");
      const data = await resp.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center">
      <h3 className="text-lg font-semibold text-foreground">
        Connect Your Gmail
      </h3>
      <p className="mt-2 text-sm text-muted">
        Connect your Gmail account to view your inbox, Google Chat messages, and
        HubSpot notifications in one place.
      </p>
      <button
        onClick={handleConnect}
        disabled={loading}
        className="mt-4 rounded-lg bg-cyan-600 px-6 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
      >
        {loading ? "Connecting..." : "Connect Gmail"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/comms/CommsConnectBanner.tsx
git commit -m "feat(comms): add CommsConnectBanner with impersonation block state"
```

---

### Task 18: Message Card Component

**Files:**
- Create: `src/components/comms/CommsMessageCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/comms/CommsMessageCard.tsx`:

```tsx
"use client";

interface CommsMessageCardProps {
  id: string;
  source: "gmail" | "hubspot" | "chat";
  from: string;
  subject?: string;
  text?: string;
  snippet?: string;
  date: string;
  isUnread?: boolean;
  isStarred?: boolean;
  hubspotDealUrl?: string;
  category?: string;
  spaceName?: string;
  onReply?: (id: string) => void;
  onAiDraft?: (id: string) => void;
  onStar?: (id: string) => void;
  onMarkRead?: (id: string) => void;
}

const SOURCE_ICONS: Record<string, string> = {
  gmail: "M",
  hubspot: "H",
  chat: "C",
};

const SOURCE_COLORS: Record<string, string> = {
  gmail: "bg-red-500/20 text-red-400",
  hubspot: "bg-orange-500/20 text-orange-400",
  chat: "bg-green-500/20 text-green-400",
};

export default function CommsMessageCard({
  id,
  source,
  from,
  subject,
  text,
  snippet,
  date,
  isUnread,
  isStarred,
  hubspotDealUrl,
  category,
  spaceName,
  onReply,
  onAiDraft,
  onStar,
  onMarkRead,
}: CommsMessageCardProps) {
  const preview = snippet || text || "";
  const displayDate = new Date(date);
  const timeStr = displayDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const dateStr = displayDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={`group relative rounded-lg border bg-surface p-3 transition-colors hover:bg-surface-2 ${
        isUnread ? "border-cyan-500/30" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Source badge */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            SOURCE_COLORS[source] || "bg-zinc-500/20 text-zinc-400"
          }`}
        >
          {SOURCE_ICONS[source] || "?"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span
              className={`truncate text-sm ${
                isUnread ? "font-semibold text-foreground" : "text-foreground"
              }`}
            >
              {from}
            </span>
            <span className="ml-2 shrink-0 text-xs text-muted">
              {dateStr} {timeStr}
            </span>
          </div>

          {subject && (
            <div className="mt-0.5 truncate text-sm text-foreground">
              {subject}
            </div>
          )}
          {spaceName && (
            <div className="mt-0.5 text-xs text-muted">in {spaceName}</div>
          )}

          <div className="mt-0.5 truncate text-xs text-muted">{preview}</div>

          {/* Badges */}
          <div className="mt-1 flex items-center gap-1.5">
            {hubspotDealUrl && (
              <a
                href={hubspotDealUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400 hover:bg-orange-500/25"
              >
                Deal
              </a>
            )}
            {category && category !== "general" && (
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
                {category.replace("_", " ")}
              </span>
            )}
            {isStarred && (
              <span className="text-yellow-400 text-xs">&#9733;</span>
            )}
          </div>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        {onReply && (
          <button
            onClick={() => onReply(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Reply
          </button>
        )}
        {onAiDraft && (
          <button
            onClick={() => onAiDraft(id)}
            className="rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30"
          >
            AI Draft
          </button>
        )}
        {onMarkRead && isUnread && (
          <button
            onClick={() => onMarkRead(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Read
          </button>
        )}
        {onStar && (
          <button
            onClick={() => onStar(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            {isStarred ? "Unstar" : "Star"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/comms/CommsMessageCard.tsx
git commit -m "feat(comms): add CommsMessageCard with source badges and hover actions"
```

---

### Task 19: Filter Sidebar & Focus Cards

**Files:**
- Create: `src/components/comms/CommsFilterSidebar.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/comms/CommsFilterSidebar.tsx`:

```tsx
"use client";

import { MiniStat } from "@/components/ui/MetricCard";

interface Props {
  source: string;
  onSourceChange: (source: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  analytics?: {
    unreadCount: number;
    totalMessages: number;
    topSenders: Array<{ email: string; count: number }>;
    chatSpaceCount: number;
  };
}

const SOURCES = [
  { value: "all", label: "All" },
  { value: "gmail", label: "Gmail" },
  { value: "chat", label: "Chat" },
  { value: "hubspot", label: "HubSpot" },
];

export default function CommsFilterSidebar({
  source,
  onSourceChange,
  searchQuery,
  onSearchChange,
  analytics,
}: Props) {
  return (
    <div className="w-56 shrink-0 space-y-4">
      {/* Source tabs */}
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase text-muted">Source</div>
        {SOURCES.map((s) => (
          <button
            key={s.value}
            onClick={() => onSourceChange(s.value)}
            className={`block w-full rounded px-3 py-1.5 text-left text-sm transition-colors ${
              source === s.value
                ? "bg-cyan-600/20 text-cyan-400 font-medium"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-cyan-500 focus:outline-none"
        />
      </div>

      {/* Focus analytics */}
      {analytics && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted">Focus</div>
          <MiniStat
            key={String(analytics.unreadCount)}
            label="Unread"
            value={analytics.unreadCount}
          />
          <MiniStat
            key={String(analytics.totalMessages)}
            label="Messages"
            value={analytics.totalMessages}
          />
          <MiniStat
            key={String(analytics.chatSpaceCount)}
            label="Chat Spaces"
            value={analytics.chatSpaceCount}
          />

          {analytics.topSenders.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-muted">Top Senders</div>
              {analytics.topSenders.slice(0, 3).map((s) => (
                <div
                  key={s.email}
                  className="flex items-center justify-between py-0.5 text-xs"
                >
                  <span className="truncate text-foreground">{s.email}</span>
                  <span className="ml-1 text-muted">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/comms/CommsFilterSidebar.tsx
git commit -m "feat(comms): add filter sidebar with source tabs, search, and focus analytics"
```

---

### Task 20: Draft Composer Drawer

**Files:**
- Create: `src/components/comms/CommsDraftDrawer.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/comms/CommsDraftDrawer.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  replyTo?: {
    from: string;
    subject: string;
    snippet: string;
    threadId?: string;
    messageId?: string;
  };
}

export default function CommsDraftDrawer({ open, onClose, replyTo }: Props) {
  const [to, setTo] = useState(replyTo?.from || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : ""
  );
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  if (!open) return null;

  async function handleAiDraft() {
    setAiLoading(true);
    try {
      const resp = await fetch("/api/comms/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalFrom: replyTo?.from || to,
          originalSubject: replyTo?.subject || subject,
          originalSnippet: replyTo?.snippet || "",
        }),
      });
      const data = await resp.json();
      if (data.body) {
        setBody(data.body);
        setAiProvider(data.provider);
      }
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCreateDraft() {
    setSaving(true);
    try {
      const resp = await fetch("/api/comms/draft", {
        method: draftId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draftId ? { draftId } : {}),
          to,
          cc: cc || undefined,
          subject,
          body,
          threadId: replyTo?.threadId,
        }),
      });
      const data = await resp.json();
      if (data.draftId) setDraftId(data.draftId);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendDraft() {
    if (!draftId) return;
    setSending(true);
    try {
      await fetch("/api/comms/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      onClose();
    } finally {
      setSending(false);
    }
  }

  async function handleFeedback(rating: "good" | "needs_work") {
    await fetch("/api/comms/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        draftBody: body,
        originalSubject: subject,
        provider: aiProvider,
      }),
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-surface shadow-card-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">
            {replyTo ? "Reply" : "New Draft"}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            &times;
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <input
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <input
            placeholder="Cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <textarea
            placeholder="Compose your email..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none"
          />

          {/* AI feedback */}
          {aiProvider && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">AI draft by {aiProvider}</span>
              <button
                onClick={() => handleFeedback("good")}
                className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
              >
                Good Draft
              </button>
              <button
                onClick={() => handleFeedback("needs_work")}
                className="rounded bg-amber-600/20 px-2 py-1 text-xs text-amber-400 hover:bg-amber-600/30"
              >
                Needs Work
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <button
            onClick={handleAiDraft}
            disabled={aiLoading}
            className="rounded-lg bg-cyan-600/20 px-3 py-2 text-sm text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-50"
          >
            {aiLoading ? "Generating..." : "AI Draft"}
          </button>
          <button
            onClick={handleCreateDraft}
            disabled={saving || !to || !subject}
            className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-foreground hover:bg-surface disabled:opacity-50"
          >
            {saving ? "Saving..." : draftId ? "Update Draft" : "Create Draft"}
          </button>
          {draftId && (
            <>
              <button
                onClick={handleSendDraft}
                disabled={sending}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Draft"}
              </button>
              <a
                href={`https://mail.google.com/mail/u/0/#drafts`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted hover:text-foreground"
              >
                Open in Gmail
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/comms/CommsDraftDrawer.tsx
git commit -m "feat(comms): add draft composer drawer with AI generation and feedback"
```

---

### Task 21: Main Dashboard Page

**Files:**
- Create: `src/app/dashboards/comms/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/app/dashboards/comms/page.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import CommsConnectBanner from "@/components/comms/CommsConnectBanner";
import CommsFilterSidebar from "@/components/comms/CommsFilterSidebar";
import CommsMessageCard from "@/components/comms/CommsMessageCard";
import CommsDraftDrawer from "@/components/comms/CommsDraftDrawer";
import { queryKeys } from "@/lib/query-keys";

export default function CommsPage() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gmailPage, setGmailPage] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const [replyTarget, setReplyTarget] = useState<any>(null);

  // Check connection status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: queryKeys.comms.status(),
    queryFn: () => fetch("/api/comms/status").then((r) => r.json()),
    staleTime: 60_000,
  });

  // Fetch messages
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.comms.messages({ source, q: searchQuery, page: gmailPage || "" }),
    queryFn: () => {
      const params = new URLSearchParams({ source });
      if (searchQuery) params.set("q", searchQuery);
      if (gmailPage) params.set("page", gmailPage);
      return fetch(`/api/comms/messages?${params}`).then((r) => r.json());
    },
    enabled: status?.connected === true,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const handleReply = useCallback((id: string) => {
    const msg = data?.messages?.find((m: any) => m.id === id);
    if (msg) {
      setReplyTarget({
        from: msg.fromEmail || msg.senderEmail || msg.from || msg.sender,
        subject: msg.subject || "",
        snippet: msg.snippet || msg.text || "",
        threadId: msg.threadId,
        messageId: msg.id,
      });
      setDrawerKey((k) => k + 1); // Reset drawer state on new reply
      setDrawerOpen(true);
    }
  }, [data]);

  const handleAiDraft = useCallback((id: string) => {
    handleReply(id); // Open drawer, then user clicks AI Draft inside
  }, [handleReply]);

  const handleNewDraft = useCallback(() => {
    setReplyTarget(null);
    setDrawerKey((k) => k + 1); // Reset drawer state
    setDrawerOpen(true);
  }, []);

  // Handle bulk actions — invalidate messages query after mutation
  async function handleMarkRead(id: string) {
    await fetch("/api/comms/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", messageIds: [id] }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.comms.root });
  }

  async function handleStar(id: string) {
    const msg = data?.messages?.find((m: any) => m.id === id);
    const action = msg?.isStarred ? "unstar" : "star";
    await fetch("/api/comms/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, messageIds: [id] }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.comms.root });
  }

  if (statusLoading) {
    return (
      <DashboardShell title="Comms" accentColor="cyan">
        <div className="flex items-center justify-center py-20 text-muted">
          Loading...
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Comms"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Not connected or impersonating */}
      {(!status?.connected || status?.impersonating) && (
        <CommsConnectBanner impersonating={status?.impersonating} />
      )}

      {/* Connected — show inbox */}
      {status?.connected && !status?.impersonating && (
        <div className="flex gap-6">
          <CommsFilterSidebar
            source={source}
            onSourceChange={setSource}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            analytics={data?.analytics}
          />

          <div className="min-w-0 flex-1 space-y-2">
            {/* Header with new draft button */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted">
                {data?.analytics?.totalMessages ?? 0} messages
              </div>
              <button
                onClick={handleNewDraft}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm text-white hover:bg-cyan-700"
              >
                + New Draft
              </button>
            </div>

            {/* Messages */}
            {isLoading && (
              <div className="py-8 text-center text-muted">
                Fetching messages...
              </div>
            )}

            {data?.unchanged && (
              <div className="py-8 text-center text-sm text-muted">
                No new messages since last check.
              </div>
            )}

            {data?.disconnected && <CommsConnectBanner />}

            {data?.messages?.map((msg: any) => (
              <CommsMessageCard
                key={msg.id}
                id={msg.id}
                source={msg.source}
                from={msg.from || msg.sender || ""}
                subject={msg.subject}
                text={msg.text}
                snippet={msg.snippet}
                date={msg.date}
                isUnread={msg.isUnread}
                isStarred={msg.isStarred}
                hubspotDealUrl={msg.hubspotDealUrl}
                category={msg.category}
                spaceName={msg.spaceName}
                onReply={msg.source !== "chat" ? handleReply : undefined}
                onAiDraft={msg.source !== "chat" ? handleAiDraft : undefined}
                onMarkRead={msg.source !== "chat" ? handleMarkRead : undefined}
                onStar={msg.source !== "chat" ? handleStar : undefined}
              />
            ))}

            {/* Load more */}
            {data?.pagination?.gmailNextPage && (
              <div className="py-4 text-center">
                <button
                  onClick={() => setGmailPage(data.pagination.gmailNextPage)}
                  className="text-sm text-cyan-400 hover:text-cyan-300"
                >
                  Load more messages
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Draft drawer — key resets form state on new reply */}
      <CommsDraftDrawer
        key={drawerKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        replyTo={replyTarget}
      />
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/comms/page.tsx
git commit -m "feat(comms): add main Comms dashboard page with inbox, filters, and draft drawer"
```

---

## Chunk 5: Final Wiring & Verification

### Task 22: Environment Variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Comms env vars to .env.example**

Add the following section:

```
# ── Comms Dashboard (Gmail/Chat OAuth) ──
COMMS_GOOGLE_CLIENT_ID=         # Google OAuth client for Comms (separate from NextAuth)
COMMS_GOOGLE_CLIENT_SECRET=     # matching client secret
COMMS_TOKEN_ENCRYPTION_KEY=     # 32-byte hex: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(comms): add Comms env vars to .env.example"
```

---

### Task 23: TypeScript & Lint Check

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Zero errors in all new Comms files.

- [ ] **Step 2: Run ESLint**

Run: `npx eslint src/lib/comms-*.ts src/app/api/comms/ src/app/dashboards/comms/ src/components/comms/ --fix`
Expected: No errors (warnings acceptable).

- [ ] **Step 3: Run all Comms tests**

Run: `npx jest --testPathPattern=comms --no-cache`
Expected: All tests pass (comms-crypto: 5, comms-auth: 3, comms-categorize: 5, comms-token: 4).

- [ ] **Step 4: Fix any issues found, then commit**

```bash
git add src/lib/comms-*.ts src/app/api/comms/ src/app/dashboards/comms/ src/components/comms/
git commit -m "chore(comms): fix lint and type errors"
```

---

### Task 24: Build Verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds. All new routes and pages are included in the output.

- [ ] **Step 2: Fix any build issues, then commit if needed**

```bash
git add src/lib/comms-*.ts src/app/api/comms/ src/app/dashboards/comms/ src/components/comms/
git commit -m "fix(comms): resolve build issues"
```
