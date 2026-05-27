# Google Chat OOO Bot

**Date**: 2026-05-26
**Status**: Design
**Ship by**: 2026-05-28 (Zach OOO starts 5/29)

## Problem

Zach (Precon Manager) is OOO 5/29 – 6/10. His precon team relies on him for process questions, escalation guidance, and project status checks. Without a proxy, questions pile up or get answered incorrectly.

## Solution

A Google Chat bot that acts as Zach's OOO proxy. The bot receives messages from the precon team (DMs + shared Spaces), runs them through Claude with Zach's decision-making playbook and live HubSpot/Zuper/scheduling data, and responds in-thread. Questions the bot can't answer are flagged to an escalation queue for Zach's return.

## Architecture

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
  ├─ Verify Google JWT signature (JWKS)
  ├─ Parse event type (MESSAGE, ADDED_TO_SPACE, REMOVED_FROM_SPACE)
  ├─ Extract sender email, display name, space ID, thread ID
  │
  ▼
lib/ooo-bot.ts
  │
  ├─ Load conversation history from DB (last 20 msgs per space+thread)
  ├─ Build system prompt:
  │   ├─ Identity & guardrails
  │   ├─ Zach's playbook (from OooBotConfig DB row)
  │   └─ Live context (date, sender info)
  ├─ Call Claude via getAnthropicClient() + toolRunner
  │   └─ Tools: reused chat-tools + new OOO-specific tools
  ├─ Save conversation turn to OooBotConversation
  ├─ If escalated → write OooBotEscalation row
  │
  ▼
Return JSON response body → Google Chat renders in-thread
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Google Chat App via service account | Only option that supports both DMs and Spaces conversationally |
| Webhook auth | Google JWT verification (JWKS) | Standard for Chat Apps; no shared-secret option available |
| Claude model | Sonnet (claude-sonnet-4-5) | Needs tool use + nuanced judgment; Haiku too thin for advisory role |
| Conversation persistence | DB-backed, 20-message window per thread | Multi-turn context without blowing up token budget |
| Playbook storage | DB config row (not hardcoded) | Editable without redeploying; can update Wednesday before OOO |
| Write actions | None (advisor only) | 3-day build window; safety; can add later |
| Escalation | Flag & queue to DB table | Zach reviews when back 6/10; no human backstop needed |
| Audience | Precon team only | Scoped via Google Chat App visibility settings in GCP console |

## Webhook Endpoint

**Route**: `POST /api/webhooks/google-chat`
**Runtime**: nodejs, maxDuration: 30
**Auth**: Google JWT signature verification

### JWT Verification

```typescript
// Verify JWT from Authorization: Bearer <token> header
// Issuer: chat@system.gserviceaccount.com
// Audience: GOOGLE_CHAT_PROJECT_NUMBER env var
// Keys: https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com
```

Cache JWKS keys in-memory with 1-hour TTL (same pattern as other key-rotation schemes in the codebase).

### Event Types

| Event | Action |
|-------|--------|
| `MESSAGE` | Process through Claude, return response |
| `ADDED_TO_SPACE` | Return welcome message |
| `REMOVED_FROM_SPACE` | No-op (200 OK) |
| Other | No-op (200 OK) |

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
- Be helpful, direct, and a little funny — like a coworker who knows the
  playbook and has a sense of humor about being a robot filling in

TONE:
- Casual and direct, not corporate
- Self-aware about being an AI ("above my pay grade — I don't have one")
- Confident when you know the answer, honest when you don't
- Brief — nobody wants a novel in Google Chat
```

### Layer 2: Playbook (from OooBotConfig.playbook)

Loaded from DB at request time. Content written with Zach on 5/28. Structure:

```markdown
## Current Priority Projects
- PROJ-XXXX: [status, what to watch for]
- ...

## Standing Rules
- If [X happens], [do Y]
- ...

## Who Handles What
- Scheduling conflicts: [person]
- BOM questions: [person]
- ...

## Common Process Questions
### How do we handle a failed inspection?
[Answer]

### What's the flow for rescheduling an install?
[Answer]

## Things to Hold for Zach
- [List of decisions that should wait]

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

### Tier 1: Reused from chat-tools.ts

| Tool | Description |
|------|-------------|
| `search_deals(query)` | Search HubSpot deals by text |
| `get_deal(dealId)` | Get deal properties by ID |
| `filter_deals_by_stage(stage)` | Find deals in a specific stage |
| `count_deals_by_stage()` | Pipeline stage counts |

These are imported from `createChatTools()` — same implementations, no duplication.

### Tier 2: New OOO-specific tools

| Tool | Input | Description |
|------|-------|-------------|
| `get_project_status(projectId)` | PROJ-XXXX string | Combined deal + Zuper job + BOM status lookup |
| `get_schedule_overview(location?, days?)` | Optional location filter, days ahead (default 7) | Upcoming installs/surveys from Google Calendar |
| `get_service_queue()` | None | Service priority queue summary (top 10 by score) |
| `escalate(question, context)` | Original question + bot's reasoning | Writes OooBotEscalation row, returns acknowledgment |
| `get_playbook_guidance(topic)` | Topic keyword | Searches playbook text for relevant section |

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
  id           String   @id @default(cuid())
  playbook     String   // Markdown playbook content
  enabled      Boolean  @default(true)
  oooStartDate DateTime
  oooEndDate   DateTime
  updatedAt    DateTime @updatedAt
}
```

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
| `src/lib/google-chat-auth.ts` | JWT verification against Google JWKS |
| `src/lib/ooo-bot.ts` | Core orchestrator — history, prompt assembly, Claude call |
| `src/lib/ooo-bot-tools.ts` | Tier 2 tools (project status, schedule, service queue, escalate, playbook) |
| `prisma/migrations/XXXX_ooo_bot/migration.sql` | Schema migration for 3 new models |

## Files to Modify

| File | Change |
|------|--------|
| `src/middleware.ts` | Add `/api/webhooks/google-chat` to `PUBLIC_API_ROUTES` |
| `prisma/schema.prisma` | Add 3 new models |
| `.env.example` | Add `GOOGLE_CHAT_PROJECT_NUMBER`, `GOOGLE_CHAT_ENABLED` |

## Build Sequence

### Day 1 (Monday 5/26) — Foundation
- Prisma schema: 3 new models + migrate
- `lib/google-chat-auth.ts` — JWT verification against Google JWKS
- `/api/webhooks/google-chat/route.ts` — webhook handler, event parsing, response
- Middleware update (PUBLIC_API_ROUTES)
- Smoke test: message → hardcoded "Hello" response

### Day 2 (Tuesday 5/27) — Brain
- `lib/ooo-bot.ts` — orchestrator (history, prompt, Claude call)
- `lib/ooo-bot-tools.ts` — Tier 2 tools
- `OooBotConfig` seed with placeholder playbook
- End-to-end test: message → Claude thinks → real response

### Day 3 (Wednesday 5/28) — Polish & Playbook
- Capture Zach's playbook content (20-30 min session)
- Error handling hardening (timeouts, malformed payloads, Claude failures)
- Escalation review endpoint (at minimum API, stretch: admin UI)
- Final testing in DMs + Space with a precon team member
- Deploy to prod, set env vars, verify

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
