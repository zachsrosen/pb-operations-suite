# Comms Dashboard — Design Spec

**Date**: 2026-04-10
**Status**: Draft
**Source repo**: `zachsrosen/unified-inbox-live` (Railway, now offline)

## Overview

Absorb the standalone "Zach's Comms" Express.js app into PB Operations Suite as a new Comms dashboard. The original app is a real-time Gmail + Google Chat + HubSpot message aggregator with AI-assisted draft generation, deployed on Railway (trial expired, no live traffic). This migration eliminates a separate hosting bill and consolidates onto the existing Vercel deployment.

## Motivation

- **Cost**: Railway trial ended; no reason to pay for a second platform.
- **Consolidation**: One codebase, one deploy, one set of env vars. Multi-user auth (NextAuth) and theme system come for free.

## Scope

### In scope (v1)

- Gmail inbox fetch, categorize, filter, search
- Google Chat spaces + messages with read state
- HubSpot message categorization (deal links, @mentions, stage changes)
- AI draft generation (Claude primary, Gemini fallback) with reply context
- Draft management (create, edit, update, send Gmail drafts)
- Per-sender and per-domain voice/template preferences
- AI feedback loop (Good Draft / Needs Work) for style learning
- Multi-user support via dedicated "Connect Gmail" OAuth flow
- Focus analytics (unread count, follow-up queue, top senders)
- Bulk actions (mark read, archive, star)

### Deferred (v2+)

- **Auto-reply agent pipeline** — shadow/live mode, approval queue, kill switch, policy engine. The entire `agent-db`, `agent-queue`, `agent-runner`, `agent-pipeline`, `agent-policy` system. Experimental in the original app; revisit once core is stable.
- **Semantic search** — embedding-based message search using Gemini `text-embedding-004`. Requires rethinking storage for serverless (pgvector or external). Basic keyword search + category filters cover most use cases.
- **Google Calendar availability suggestions** — PB Ops Suite already has its own calendar integration; low incremental value.

## Architecture

### Navigation & Routing

- New **Comms** dashboard under Operations suite initially (promote to own suite when adoption grows)
- Role gating: `ADMIN`, `EXECUTIVE` initially; expand as adoption grows
- Dashboard pages:
  - `/dashboards/comms` — main inbox (Gmail + Chat + HubSpot unified view)
- Draft composer is an inline drawer panel, not a separate page

### API Routes

New route group at `src/app/api/comms/`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/comms/messages` | GET | Fetch Gmail inbox (paginated, filtered by source/category/priority) |
| `/api/comms/chat` | GET | Fetch Google Chat spaces + messages |
| `/api/comms/draft` | POST | Create Gmail draft |
| `/api/comms/draft` | PUT | Update existing Gmail draft |
| `/api/comms/draft/send` | POST | Send a Gmail draft |
| `/api/comms/ai-draft` | POST | Generate AI reply/compose draft |
| `/api/comms/feedback` | POST | Submit Good Draft / Needs Work feedback |
| `/api/comms/preferences` | GET/PUT | Per-sender or per-domain voice/template preferences |
| `/api/comms/bulk` | POST | Batch mark-read, archive, star |
| `/api/comms/connect` | GET | Initiate Gmail OAuth connect flow |
| `/api/comms/connect/callback` | GET | OAuth callback, store tokens |
| `/api/comms/status` | GET | Connection status for current user |
| `/api/comms/connect` | DELETE | Disconnect Gmail, revoke token |

### Data Flow — On-Demand Delta Sync

The original Express app used a long-running process with 60-second polling. Vercel serverless functions are ephemeral and don't share in-memory state across isolates, so a cron-warms-cache approach won't work. Instead, the API routes themselves perform delta sync on demand.

```
Client opens /dashboards/comms
        │
        ▼
  React Query → GET /api/comms/messages
        │
        ├─ Read CommsUserState for current user (gmailHistoryId, chatLastSyncAt)
        ├─ Decrypt tokens from CommsGmailToken
        ├─ Delta fetch Gmail (since last historyId) via raw fetch
        ├─ Delta fetch Chat (since last sync timestamp) via raw fetch
        ├─ Categorize messages (HubSpot deal detection, @mentions, etc.)
        ├─ Update CommsUserState (new historyId, sync timestamp)
        └─ Return messages to client
                │
                ▼
        Client renders inbox, polls every 60s via React Query refetchInterval
```

**Why no cron**: Vercel Pro's minimum cron interval is 10 minutes, and even with a cron, the cache it warms lives in one isolate and is invisible to the API route handling the next request. On-demand delta sync is both simpler and more reliable.

**Why no SSE**: SSE connections are held in one isolate; a mutation in another isolate can't push to them. Client-side polling (React Query `refetchInterval: 60_000`) provides near-real-time updates without cross-isolate coordination.

### Performance Characteristics

- **First load**: Full Gmail/Chat fetch (~2-3s). Subsequent requests use delta sync (~200-500ms).
- **Delta sync**: Gmail `history.list` API returns only changes since last `historyId`. Chat uses `orderBy=lastActiveTime` with timestamp filter. Both are lightweight.
- **Pagination**: Gmail messages paginated (50 per page default). Large inboxes don't block on full fetch.
- **Stale time**: React Query `staleTime: 30_000` (30s). Within 30s of a fetch, cached client-side data is served instantly.
- **Vercel function timeout**: Default 60s (`maxDuration` in `vercel.json`). Delta syncs complete well within this. Initial full fetch for very large inboxes may need pagination to stay under.

## Data Model

### New Prisma Models

```prisma
model CommsGmailToken {
  id                Int      @id @default(autoincrement())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id])
  gmailAccessToken  String   // AES-256-GCM encrypted
  gmailRefreshToken String   // AES-256-GCM encrypted
  gmailTokenExpiry  BigInt   @default(0)
  chatEnabled       Boolean  @default(false)
  scopes            String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model CommsAiMemory {
  id        Int      @id @default(autoincrement())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  kind      String   // "feedback" | "style_example" | "sender_pref" | "domain_pref"
  key       String   @default("")  // sender email or domain
  data      Json
  createdAt DateTime @default(now())

  @@index([userId, kind])
  @@index([userId, kind, key])
}

model CommsUserState {
  id              Int      @id @default(autoincrement())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  gmailHistoryId  String   @default("")
  chatLastSyncAt  DateTime?
  lastRefreshedAt DateTime?
  updatedAt       DateTime @updatedAt
}
```

Note: `userId` is `String` to match the existing `User.id` which uses `@default(cuid())`.

### No message storage

Messages are never written to the database. This is intentional:
- Reduces data exposure surface (no email content at rest)
- Avoids syncing/dedup complexity
- Gmail/Chat APIs are the source of truth
- Cache provides fast reads for active sessions

### Migration from SQLite

| SQLite source | Destination | Notes |
|---------------|-------------|-------|
| `users` table (gmail tokens) | `CommsGmailToken` | Re-auth required; can't migrate encrypted tokens across encryption keys |
| `sessions` table | NextAuth handles | No migration needed |
| `.ai-memory.json` | `CommsAiMemory` | Optional one-time import script if data is valuable |
| `.cache-snapshot.json` | In-memory cache | Rebuilt from APIs, no migration |
| `agent_*` tables | Deferred | Not in scope |
| `.auto-reply-settings.json` | Deferred | Not in scope |

**Re-auth note**: Users will need to "Connect Gmail" once in PB Ops Suite. This is expected since the OAuth client will be different.

## Security

### Token Encryption

- New env var `COMMS_TOKEN_ENCRYPTION_KEY` (32-byte hex)
- AES-256-GCM encrypt/decrypt in `lib/comms-crypto.ts`
- Same algorithm as original `user-db.js` (IV + auth tag + ciphertext, base64 encoded)
- Tokens encrypted before Prisma write, decrypted on read

### OAuth Isolation

- Separate OAuth client (`COMMS_GOOGLE_CLIENT_ID` / `COMMS_GOOGLE_CLIENT_SECRET`) from the main NextAuth login client
- Prevents scope creep: regular PB Ops login doesn't prompt for Gmail access
- "Connect Gmail" is an explicit user action on the Comms dashboard
- OAuth scopes requested:
  - `gmail.modify` — read, label, archive
  - `gmail.compose` — create/send drafts
  - `chat.spaces.readonly` — list Chat spaces
  - `chat.messages.readonly` — read Chat messages
  - `chat.users.readstate.readonly` — unread indicators
  - `contacts.readonly` — resolve sender names

### Access Control

- Comms API routes require authenticated NextAuth session
- Role-gated to `ADMIN` + `EXECUTIVE` initially (configurable in `role-permissions.ts`)
- Every Gmail/Chat API call uses the requesting user's own tokens — no cross-user access
- User can only see their own messages, drafts, and preferences

### Rate Limiting

- Gmail API: 250 quota units/sec per user. On-demand delta sync is lightweight (single `history.list` call per request).
- Client-side: React Query `staleTime: 30_000` + `refetchInterval: 60_000` prevents excessive API calls
- Multiple browser tabs from same user: React Query deduplicates concurrent requests

### Token Revocation & Disconnect

- **Disconnect flow**: "Disconnect Gmail" button on Comms dashboard calls `DELETE /api/comms/connect`. Deletes `CommsGmailToken` and `CommsUserState` for the user. Revokes the token with Google's revocation endpoint.
- **Token refresh failure**: If Gmail API returns 401 (token revoked/expired), the API route clears the stored tokens and returns a `{ disconnected: true }` response. The frontend shows the "Connect Gmail" banner again.
- **Google revocation**: Google revokes refresh tokens after 6 months of non-use or if the user removes the app from their Google Account settings. The 401 detection handles this gracefully.

## Frontend

### Main Page: `/dashboards/comms`

```tsx
<DashboardShell
  title="Comms"
  accentColor="cyan"
  lastUpdated={data?.lastUpdated}
  fullWidth={true}
>
```

**Layout**: Filter sidebar (left) + message list (center/right).

**Filter sidebar**:
- Source tabs: All / Gmail / Chat / HubSpot
- Priority filter (MultiSelectFilter)
- Category filter (MultiSelectFilter)
- Search box (keyword, not semantic)
- Focus analytics cards (MiniStat): unread count, follow-up queue size, top senders

**Message list**:
- Cards showing: sender, subject/preview, timestamp, unread indicator, source icon, star
- HubSpot-linked messages show deal badge with link
- Hover/tap reveals inline actions: Reply with Draft, AI Draft, Mark Read, Archive, Star
- Pagination or virtual scroll for large inboxes

### Draft Composer Drawer

Right-side drawer panel (similar pattern to `BomHistoryDrawer`):
- To / Cc / Subject fields (pre-filled on reply)
- Body textarea
- Voice/template selector (auto-applies saved sender/domain preferences)
- **AI Draft** button → calls `/api/comms/ai-draft`, populates body
- **Create Draft** / **Update Draft** / **Send Draft** buttons
- **Good Draft** / **Needs Work** feedback buttons (after AI generation)
- **Open in Gmail** link

### Connect Gmail Banner

On first visit, if user has no `CommsGmailToken`:
- Full-width banner: "Connect your Gmail to use Comms"
- "Connect Gmail" button triggers OAuth flow
- After successful connection, banner disappears, inbox loads

### Data Fetching

```tsx
const { data } = useQuery({
  queryKey: queryKeys.comms.messages(filters),
  queryFn: () => fetch('/api/comms/messages?' + params).then(r => r.json()),
  staleTime: 30_000,
  refetchInterval: 60_000,
});

// Client-side polling — no SSE for Comms (serverless isolates can't push cross-isolate)
// refetchInterval provides near-real-time updates
```

Cache keys registered in `lib/query-keys.ts`:
- `comms:messages` — Gmail messages
- `comms:chat` — Chat messages
- `comms:drafts` — Active drafts
- `comms:status` — Connection status

## Environment Variables

```
# Comms OAuth (separate from NextAuth login)
COMMS_GOOGLE_CLIENT_ID=        # Google OAuth client for Comms
COMMS_GOOGLE_CLIENT_SECRET=    # matching secret
COMMS_TOKEN_ENCRYPTION_KEY=    # 32-byte hex for token encryption
```

Reused from existing env: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (AI drafting), `HUBSPOT_PORTAL_ID` (HubSpot link detection — no separate `COMMS_HUBSPOT_PORTAL` needed).

## Integration Points

Existing files that need changes to wire Comms into PB Ops Suite:

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `CommsGmailToken`, `CommsAiMemory`, `CommsUserState` models + relation fields on `User` |
| `src/lib/suite-nav.ts` | Add Comms suite entry with `ADMIN`, `EXECUTIVE` role visibility |
| `src/lib/role-permissions.ts` | Add `/dashboards/comms` and `/api/comms` to `ADMIN` + `EXECUTIVE` allowedRoutes |
| `src/middleware.ts` | No changes needed — Comms routes are session-authenticated, not public |
| `src/lib/query-keys.ts` | Add `comms` query key namespace |
| `vercel.json` | No cron registration needed (on-demand sync, no cron) |

## HubSpot Message Source

"HubSpot messages" in the inbox are **not fetched from a HubSpot API**. They are Gmail emails from HubSpot notification addresses (e.g., `@hubspot.com`, `@hs-inbox.com`) that get categorized by sender domain and subject line pattern matching. The categorization logic in `comms-categorize.ts` identifies:
- Deal stage change notifications
- @mention notifications
- Task assignments
- Comment notifications

These are tagged with a `source: 'hubspot'` field and rendered with a HubSpot badge + direct deal link (constructed from `HUBSPOT_PORTAL_ID` + deal ID extracted from the email body/URL).

## Draft Lifecycle

1. User clicks "Reply with Draft" or "+ New Draft" → drawer opens with pre-filled fields
2. Optional: user clicks "AI Draft" → `POST /api/comms/ai-draft` generates body text, populates textarea
3. User edits To/Cc/Subject/Body as needed
4. User clicks "Create Draft" → `POST /api/comms/draft` creates a Gmail draft via Gmail API
5. User can "Update Draft" (PUT) or "Open in Gmail" to continue editing there
6. User clicks "Send Draft" → `POST /api/comms/draft/send` sends via Gmail API
7. After AI generation, "Good Draft" / "Needs Work" buttons → `POST /api/comms/feedback` saves to `CommsAiMemory`

The AI Draft step generates text only — it does NOT create a Gmail draft. That's a separate explicit action.

## File Structure

```
src/
├── app/
│   ├── api/comms/
│   │   ├── messages/route.ts       # Gmail inbox fetch
│   │   ├── chat/route.ts           # Google Chat fetch
│   │   ├── draft/route.ts          # Create/update draft
│   │   ├── draft/send/route.ts     # Send draft
│   │   ├── ai-draft/route.ts       # AI generation
│   │   ├── feedback/route.ts       # Draft feedback
│   │   ├── preferences/route.ts    # Sender/domain prefs
│   │   ├── bulk/route.ts           # Batch actions
│   │   ├── connect/route.ts        # GET: OAuth initiate, DELETE: disconnect
│   │   ├── connect/callback/route.ts # OAuth callback
│   │   └── status/route.ts         # Connection status
│   └── dashboards/comms/page.tsx        # Main Comms dashboard
├── components/comms/
│   ├── CommsInbox.tsx              # Message list + filters
│   ├── CommsMessageCard.tsx        # Individual message card
│   ├── CommsDraftDrawer.tsx        # Draft composer drawer
│   ├── CommsConnectBanner.tsx      # "Connect Gmail" banner
│   ├── CommsFilterSidebar.tsx      # Source/priority/category filters
│   └── CommsFocusCards.tsx         # Focus analytics metrics
├── lib/
│   ├── comms-gmail.ts              # Gmail API helpers (fetch, categorize, delta sync)
│   ├── comms-chat.ts               # Google Chat API helpers
│   ├── comms-ai-draft.ts           # AI draft generation (Claude/Gemini)
│   ├── comms-crypto.ts             # AES-256-GCM token encryption
│   ├── comms-categorize.ts         # Message categorization (HubSpot detection, etc.)
│   └── comms-email-compose.ts      # Draft create/update/send helpers
```

## Port Mapping

Key logic migrations from the original Express app:

| Original file | New location | What changes |
|---------------|-------------|-------------|
| `server.js` (Gmail fetch) | `lib/comms-gmail.ts` | Rewrite to use raw `fetch` against Gmail REST API (matching `google-calendar.ts` pattern), per-user tokens from DB |
| `server.js` (Chat fetch) | `lib/comms-chat.ts` | Same API calls, per-user tokens |
| `server.js` (categorization) | `lib/comms-categorize.ts` | Pure logic, minimal changes |
| `lib/email-compose.js` | `lib/comms-email-compose.ts` | TypeScript, remove DI pattern, use direct imports |
| `lib/ai-generation.js` | `lib/comms-ai-draft.ts` | TypeScript, drop OpenAI (use Claude + Gemini only), use existing Anthropic client pattern |
| `lib/gmail-client.js` | `lib/comms-gmail.ts` | Merge into Gmail helpers |
| `lib/user-db.js` | Prisma `CommsGmailToken` | Replace SQLite with Prisma queries |
| `lib/auth-routes.js` | `api/comms/connect/` routes | NextAuth session + separate OAuth flow |
| `dashboard.html` | `dashboards/comms/page.tsx` | React + Tailwind + DashboardShell |
| `lib/agent-*.js` | Not ported | Deferred |
| `lib/policy-primitives.js` | Not ported | Agent-related |

## Open Questions

1. **Suite placement**: Should Comms be its own suite in the switcher, or nested under an existing suite (e.g., Operations)? The project already has 9 suites; a 10th that's only for 2 users initially adds switcher weight. Recommendation: start as a dashboard under Operations, promote to its own suite when more users are added.
2. **Role expansion timeline**: When to open beyond ADMIN + EXECUTIVE? After v1 is stable and tested.
3. **AI memory import**: Worth writing a one-time script to import `.ai-memory.json` from the old app, or start fresh? Depends on how much feedback data exists.
4. **`googleapis` vs raw `fetch`**: The original app uses the `googleapis` npm package (large bundle). PB Ops Suite's existing Google integrations use raw `fetch`. Recommendation: use raw `fetch` for consistency and bundle size. The Gmail REST API is well-documented and the calls are straightforward.
