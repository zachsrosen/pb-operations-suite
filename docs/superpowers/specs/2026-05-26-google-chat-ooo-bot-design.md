# Google Chat OOO Bot

**Date**: 2026-05-26
**Status**: Design
**Ship by**: 2026-05-28 (Zach OOO starts 5/29)

## Problem

Zach (Precon Manager) is OOO 5/29 – 6/10. His precon team relies on him for process questions, escalation guidance, and project status checks. Without a proxy, questions pile up or get answered incorrectly.

## Solution

A Google Chat bot that acts as Zach's OOO proxy. The bot receives messages from the precon team (DMs + shared Spaces), runs them through Claude with Zach's decision-making playbook and live HubSpot/Zuper/scheduling data, and responds in-thread. Questions the bot can't answer are flagged to an escalation queue for Zach's return.

## Architecture

**Async response pattern**: Google Chat enforces a 30-second response deadline on webhooks. Claude + tool calls (HubSpot, Zuper, Calendar APIs with retry) can easily exceed that. The bot uses a two-phase response:

1. **Phase 1 (synchronous, <2s)**: Webhook validates JWT, deduplicates by message ID, returns an immediate acknowledgment ("Let me check on that...") or handles simple events (welcome, removal) directly.
2. **Phase 2 (async, via `waitUntil`)**: Claude processing + tool calls run in the background. When complete, the bot posts the real answer via `spaces.messages.create` using the service account + Chat API.

```
Google Chat (DM or Space)
  │
  │  User sends message / @mentions bot
  │
  ▼
Google Chat Platform
  │
  │  HTTP POST (signed JWT)
  │
  ▼
/api/webhooks/google-chat/route.ts
  │
  ├─ Verify Google JWT via `jose` JWKS (cached 1hr)
  ├─ Deduplicate by message ID (IdempotencyKey table)
  ├─ Parse event type
  │
  ├─ ADDED_TO_SPACE → return welcome message (sync)
  ├─ REMOVED_FROM_SPACE → no-op (200 OK)
  ├─ MESSAGE →
  │   ├─ Return immediate { text: "🤔 Let me check on that..." } (sync)
  │   └─ Fire async via waitUntil():
  │
  ▼ (async, background)
lib/ooo-bot.ts
  │
  ├─ Load conversation history from DB (last 20 msgs per space+thread)
  ├─ Build system prompt:
  │   ├─ Identity & guardrails
  │   ├─ Zach's playbook (from OooBotConfig DB row)
  │   └─ Live context (date, sender info)
  ├─ Call Claude via getAnthropicClient() + toolRunner
  │   └─ Tools: read-only subset of chat-tools + new OOO-specific tools
  ├─ Save conversation turn to OooBotConversation
  ├─ If escalated → write OooBotEscalation row
  │
  ▼
Post response via Google Chat API: spaces.messages.create
  └─ Uses service account token (same JWT-signing pattern as google-calendar.ts)
     with https://www.googleapis.com/auth/chat.bot scope
```

For simple greetings and the welcome message, the bot responds synchronously (return JSON body). For anything requiring Claude/tools, it responds asynchronously to avoid the 30s wall.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Google Chat App via service account | Only option that supports both DMs and Spaces conversationally |
| Webhook auth | Google JWT verification (JWKS) | Standard for Chat Apps; no shared-secret option available |
| Response pattern | Async via `waitUntil` + `spaces.messages.create` | Google Chat 30s webhook deadline; Claude + tools can take 10-20s |
| Claude model | `CLAUDE_MODELS.sonnet` | Needs tool use + nuanced judgment; Haiku too thin for advisory role |
| JWT library | `jose` (npm) | Lightweight, edge-compatible, JWKS auto-rotation support |
| Conversation persistence | DB-backed, 20-message window per thread | Multi-turn context without blowing up token budget |
| Playbook storage | DB config row (not hardcoded) | Editable without redeploying; can update Wednesday before OOO |
| Write actions | None (advisor only) | 3-day build window; safety; can add later |
| Escalation | Flag & queue to DB table | Zach reviews when back 6/10; no human backstop needed |
| Audience | Precon team only | Scoped via Google Chat App visibility settings in GCP console |

## Webhook Endpoint

**Route**: `POST /api/webhooks/google-chat`
**Runtime**: nodejs, maxDuration: 30
**Auth**: Google JWT signature verification

### JWT Verification (via `jose`)

```typescript
// Uses jose library: createRemoteJWKSet + jwtVerify
// JWKS URL: https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com
// Expected claims:
//   iss: chat@system.gserviceaccount.com
//   aud: GOOGLE_CHAT_PROJECT_NUMBER env var
// jose caches JWKS keys automatically with configurable TTL (use 1hr)
```

### Idempotency

Google Chat may retry webhook deliveries on timeout. Deduplicate using the existing `IdempotencyKey` Prisma model, keyed on the `message.name` field from the Google Chat event payload (globally unique message ID). If a duplicate is detected, return 200 with no action.

### Sender Filtering

Defense-in-depth beyond GCP console visibility settings: reject messages from senders whose email doesn't end with `@photonbrothers.com`. Return a polite "I only respond to Photon Brothers team members" message.

### Event Types

| Event | Response | Sync/Async |
|-------|----------|------------|
| `MESSAGE` | Immediate "thinking..." + async Claude response | Sync ack → async answer |
| `ADDED_TO_SPACE` | Welcome message | Sync |
| `REMOVED_FROM_SPACE` | No-op (200 OK) | Sync |
| Other | No-op (200 OK) | Sync |

### Error Handling

If Claude fails (API error, timeout, rate limit), the async handler catches the error and posts a fallback message via the Chat API:

> "I ran into a technical issue processing that. Try again in a minute — if it keeps happening, ping Caleb or Patrick on IT."

The webhook handler itself always returns 200 to prevent Google from retrying (which would cause duplicate processing).

### Middleware

Add to `PUBLIC_API_ROUTES` in `src/middleware.ts`:
```typescript
"/api/webhooks/google-chat", // Google Chat bot — JWT signature validated in route
```

## System Prompt

Three-layer prompt assembled at request time:

### Layer 1: Identity & Guardrails

```
You are Zach's OOO assistant for the precon team at Photon Brothers (a solar
installation company). Zach is out of office from May 29 to June 10, 2026.

You have Zach's operational playbook and access to live project data. You help
the precon team with process questions, project status lookups, scheduling
visibility, and general guidance based on how Zach runs things.

RULES:
- Always identify yourself as Zach's OOO bot, never pretend to be Zach
- You CANNOT: approve things, make commitments, change data, reassign crews,
  move deals, send emails, or override anyone's decisions
- If you're not confident in an answer, use the escalate tool to flag it
- When you escalate, tell the person it's been queued for Zach's return
- For process/how-to questions, use the search_sop tool first — the SOP
  guides have most standard procedures documented
- Be helpful, direct, and a little funny — like a coworker who knows the
  playbook and has a sense of humor about being a robot filling in

TONE:
- Casual and direct, not corporate
- Self-aware about being an AI ("above my pay grade — I don't have one")
- Confident when you know the answer, honest when you don't
- Brief — nobody wants a novel in Google Chat
```

### Layer 2: Playbook (from OooBotConfig.playbook)

Loaded from DB at request time. Content written with Zach on 5/28.

**Division of labor — Playbook vs. SOPs**: The SOP system already documents standard procedures (HubSpot workflows, pipeline steps, scheduling flows). The playbook does NOT duplicate those — instead it covers Zach-specific judgment calls and current context that the SOPs don't have. When someone asks "how do I reschedule an install?", the bot should use `search_sop` to find the SOP. When someone asks "should I reschedule the Smith install?", the bot uses the playbook for context.

Structure:

```markdown
## Current Priority Projects
- PROJ-XXXX: [status, what to watch for, any special instructions]
- ...

## Standing Rules (things Zach would decide on the spot)
- If [X happens], [do Y]
- ...

## Who Handles What While I'm Out
- Scheduling conflicts: [person]
- BOM questions: [person]
- ...

## Zach's Judgment Calls (not in SOPs)
### When to escalate a stalled project vs. wait
[Zach's criteria]

### How to prioritize competing installs
[Zach's approach]

## Things to Hold for My Return
- [List of decisions that should wait until 6/10]

## Key Contacts
- [Name]: [role], [what they handle]
```

### Layer 3: Live Context (injected per-request)

```
Current date/time: {now}
Message from: {senderName} ({senderEmail})
Space: {spaceName or "Direct Message"}
```

## Tools

### Tier 1: Read-only tools from chat-tools.ts

| Tool | Description |
|------|-------------|
| `search_deals(query)` | Search HubSpot deals by text |
| `get_deal(dealId)` | Get deal properties by ID |
| `filter_deals_by_stage(stage)` | Find deals in a specific stage |
| `count_deals_by_stage()` | Pipeline stage counts |

**Important**: Do NOT reuse `createChatTools()` wholesale. It includes `run_review` and `get_review_status` which acquire locks and start async processes — not read-only. Instead, extract the four read-only tool definitions above into a shared `createReadOnlyChatTools()` function (or selectively import the individual tool factory functions) and use only those.

### Tier 2: New OOO-specific tools

| Tool | Input | Description |
|------|-------|-------------|
| `get_project_status(projectId)` | PROJ-XXXX string | Combined deal + Zuper job + BOM status lookup |
| `get_schedule_overview(location?, days?)` | Optional location filter, days ahead (default 7) | Upcoming installs/surveys from all location-specific Google Calendars. Resolves calendar IDs via existing `GOOGLE_INSTALL_CALENDAR_*` env vars. Uses `google-calendar.ts` module. |
| `get_service_queue()` | None | Service priority queue summary (top 10 by score) via `service-priority.ts` |
| `escalate(question, context)` | Original question + bot's reasoning | Writes OooBotEscalation row, returns acknowledgment |
| `search_sop(query)` | Topic keyword or question | Searches SOP sections by title + content, returns matching section titles and stripped content. Queries `SopSection` table via `LIKE` on title + content fields. Returns top 5 matches with tab label, section title, and content (HTML stripped to plain text, truncated to 2000 chars per section). |

**Removed**: `get_playbook_guidance(topic)` — unnecessary. The playbook is already injected into the system prompt (Layer 2), so Claude can answer playbook questions directly without a tool call. Saves a tool iteration and ~2s latency.

**SOP integration**: The existing SOP system (`SopTab` → `SopSection`) already codifies most process knowledge (HubSpot workflows, project pipeline steps, scheduling flows, etc.). Rather than duplicating this into the playbook, the bot uses `search_sop` to pull relevant SOP content on demand. The playbook (Layer 2) focuses on Zach-specific decision rules, current priorities, and standing instructions — things that aren't in the SOPs. The SOP tool handles "how does X work?" while the playbook handles "what would Zach do about X?"

**Tool file**: `src/lib/ooo-bot-tools.ts`

Each tool uses `betaZodTool` with Zod input schema. Dynamic imports for lib modules (same pattern as chat-tools.ts).

### Tool Guardrails

- All tools are **read-only** — no mutations to HubSpot, Zuper, Zoho, or any DB table other than OooBot* tables
- `max_iterations: 5` on toolRunner (same as existing chat)
- Tools that hit external APIs reuse existing rate-limit retry wrappers

## Personality & Tone Examples

The bot should feel like a helpful coworker who knows Zach's playbook and has a sense of humor about being a robot filling in. Not every message needs a joke — but personality should come through naturally.

### Welcome Message (ADDED_TO_SPACE)

DM welcome:
> Hey — Zach's off pretending mountains exist outside of Colorado. I'm his AI stand-in. I've got his playbook, access to the live data, and zero ability to approve PTO. What's up?

Space welcome:
> 👋 Zach's OOO bot reporting for duty. I've got his playbook loaded and can look up projects, schedules, and pipeline status. I can't approve anything or make promises, but I can usually point you in the right direction. If I'm stumped, I'll flag it for Zach when he's back June 10th.

### Confident Answer

> PROJ-4521 is in Permitting, been there 6 days. Nothing's on fire. Yet.

### Escalation

> Yeah, this is above my pay grade (I don't have a pay grade). I've flagged it for Zach — he's back June 10th. If it's actually urgent-urgent, you know his number.

### Honest Uncertainty

> I could guess but Zach would roast me when he reads the logs. Queuing this one for him.

### Schedule Lookup

> Westminster's got 3 installs this week — Tuesday, Wednesday, Friday. Thursday's wide open if you need to slot something in. Want the details?

## Data Model

### OooBotConversation

Stores conversation turns for multi-turn context.

```prisma
model OooBotConversation {
  id          String   @id @default(cuid())
  spaceId     String   // Google Chat space ID or "dm:{email}"
  threadId    String?  // Thread ID for threaded replies
  senderEmail String
  senderName  String
  role        String   // "user" | "assistant"
  content     String
  model       String?  // Claude model (assistant msgs only)
  toolsUsed   String[] // Tools Claude invoked
  createdAt   DateTime @default(now())

  @@index([spaceId, threadId, createdAt])
}
```

### OooBotEscalation

Queued questions for Zach's return.

```prisma
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
```

### OooBotConfig

Runtime configuration — playbook, kill switch, date range.

```prisma
model OooBotConfig {
  id           String   @id @default("default")  // Singleton — always "default"
  playbook     String   // Markdown playbook content
  enabled      Boolean  @default(true)
  oooStartDate DateTime
  oooEndDate   DateTime
  updatedAt    DateTime @updatedAt
}
```

**Singleton pattern**: `id` defaults to `"default"`. The orchestrator always queries `findFirst()`. Seed script uses `upsert` with `id: "default"`.

**Playbook editing**: For v1, playbook is edited via Prisma Studio or direct SQL update. Admin UI for editing is a post-OOO follow-up.

### Conversation Cleanup

`OooBotConversation` rows are retained for 90 days after `createdAt`, then pruned. Can be added to the existing `audit-retention` cron pattern. For the 12-day OOO window this is a non-issue — cleanup is for long-term hygiene if the bot becomes permanent.

### Thread ID Handling

In DM conversations, Google Chat may not provide a `threadId` (DMs can be flat). When `threadId` is null, conversation history is keyed on `spaceId` alone. The `spaceId` for DMs is already unique per user (Google assigns a unique space per DM pair).

## Environment Variables

| Variable | Purpose | New? |
|----------|---------|------|
| `GOOGLE_CHAT_PROJECT_NUMBER` | JWT audience verification | ✅ New |
| `GOOGLE_CHAT_ENABLED` | Kill switch | ✅ New |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account for Chat API | Existing |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account key | Existing |
| `ANTHROPIC_API_KEY` | Claude API | Existing |

## Google Cloud Setup (Manual, One-Time)

Performed by Zach or Caleb in Google Cloud Console (~30 min):

1. **Enable Google Chat API** in existing GCP project
2. **Configure Chat App**:
   - Name: "Zach's OOO Assistant"
   - Description: "Precon team assistant while Zach is OOO 5/29 - 6/10"
   - Functionality: ✅ DMs, ✅ Spaces
   - Connection: HTTP endpoint → `https://pbtechops.com/api/webhooks/google-chat`
   - Visibility: Specific people → precon team emails
3. **Domain-wide delegation**: Add `https://www.googleapis.com/auth/chat.bot` scope to existing service account delegation config

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/api/webhooks/google-chat/route.ts` | Webhook endpoint — JWT auth, event parsing, response |
| `src/lib/google-chat-auth.ts` | JWT verification via `jose` against Google JWKS |
| `src/lib/google-chat-api.ts` | Google Chat API client — `postMessage()` for async responses using service account |
| `src/lib/ooo-bot.ts` | Core orchestrator — history, prompt assembly, Claude call |
| `src/lib/ooo-bot-tools.ts` | Tier 2 tools (project status, schedule, service queue, escalate) |
| `prisma/migrations/XXXX_ooo_bot/migration.sql` | Schema migration for 3 new models |

## Files to Modify

| File | Change |
|------|--------|
| `src/middleware.ts` | Add `/api/webhooks/google-chat` to `PUBLIC_API_ROUTES` |
| `src/lib/chat-tools.ts` | Extract read-only tools into `createReadOnlyChatTools()` |
| `prisma/schema.prisma` | Add 3 new models |
| `package.json` | Add `jose` dependency |
| `.env.example` | Add `GOOGLE_CHAT_PROJECT_NUMBER`, `GOOGLE_CHAT_ENABLED` |

## Build Sequence

### Day 1 (Monday 5/26) — Foundation
- Install `jose` package
- Prisma schema: 3 new models + migrate
- `lib/google-chat-auth.ts` — JWT verification via `jose` JWKS
- `lib/google-chat-api.ts` — Chat API client (`postMessage` for async responses)
- `/api/webhooks/google-chat/route.ts` — webhook handler with async response pattern
- Middleware update (PUBLIC_API_ROUTES)
- Refactor: extract `createReadOnlyChatTools()` from `chat-tools.ts`
- Smoke test: message → immediate "thinking" ack + async "Hello" response

### Day 2 (Tuesday 5/27) — Brain
- `lib/ooo-bot.ts` — orchestrator (history, prompt, Claude call, async post)
- `lib/ooo-bot-tools.ts` — Tier 2 tools (project status, schedule, service queue, escalate)
- `OooBotConfig` seed with placeholder playbook (upsert, id: "default")
- IdempotencyKey integration for message dedup
- End-to-end test: message → Claude thinks → real async response in thread

### Day 3 (Wednesday 5/28) — Polish & Playbook
- Capture Zach's playbook content (20-30 min session)
- Error handling hardening (Claude failures → friendly fallback via Chat API)
- Sender domain filtering (`@photonbrothers.com` only)
- Escalation review endpoint (at minimum API, stretch: admin UI)
- Final testing in DMs + Space with a precon team member
- Deploy to prod, set env vars in Vercel, verify

## What Ships vs. Future

| Ships before 5/29 | Future |
|---|---|
| DM + Space messaging | Rich card formatting (buttons, structured responses) |
| Live deal/schedule/service lookups | Write actions (reassign, move deals) |
| Escalation queue (flag & queue) | Daily digest of bot activity emailed to Zach |
| Kill switch (env var + DB) | Permanent team assistant mode |
| Playbook in DB (editable without deploy) | Admin UI for playbook editing |
| Conversation history (20-msg window) | Analytics on question patterns |
| Personality/humor in responses | Team-specific personality tuning |

## Teardown

After Zach returns 6/10:
1. Set `GOOGLE_CHAT_ENABLED=false` in Vercel → bot stops immediately
2. Or set `enabled: false` in `OooBotConfig` DB row
3. Optionally disable Chat App in GCP console
4. Code stays in repo — can evolve into permanent team assistant

## Non-Goals

- **No write actions**: Bot cannot modify deals, reassign crews, approve BOMs, or send emails
- **No audience expansion**: Precon team only for v1
- **No rich UI**: Text responses only; cards/buttons are future
- **No proactive messaging**: Bot only responds when asked; doesn't initiate conversations
- **No integration with existing ChatWidget**: Separate endpoint, separate system prompt, separate tools
