# AI Assistant Layer — Design Doc

**Date:** 2026-03-01
**Scope:** Hybrid AI assistant layer — deterministic check engine for automated reviews + Claude chat for conversational interface
**Depends on:** Role-based skill definitions (PR #68), existing HubSpot/Zuper integrations, next-auth v5 auth

---

## Problem

PB Operations Suite has three role-based skills (design-reviewer, engineering-reviewer, sales-advisor) defined as SKILL.md instruction documents. These work in Claude Code terminal for Zach but are inaccessible to the broader team (designers, PMs, salespeople). There is no way to:

1. Run a design review from the dashboard without terminal access
2. Automatically gate pipeline stage transitions with quality checks
3. Ask project-specific questions in natural language from the dashboard
4. Persist and track review results over time

**Goal:** Build an AI assistant layer that serves three interfaces — Claude Code terminal (Zach), dashboard UI (team), and pipeline webhooks (automated) — using a hybrid architecture: deterministic check engine for speed and reliability, Claude API for conversational chat.

---

## Design Principles

| Principle | Detail |
|-----------|--------|
| Hybrid architecture | Deterministic checks for action buttons + webhooks; Claude API only for chat and nuanced analysis |
| Shared data layer | Both systems use the same HubSpot client, planset access, Prisma models — no duplication |
| Existing patterns only | DashboardShell, MetricCard, useSSE, requireApiAuth, waitUntil — nothing novel |
| Role-gated everything | Skill visibility and execution follow existing UserRole permissions |
| SKILL.md as documentation | Terminal skills stay as-is for Claude Code; check engine is the source of truth for automated checks |
| Fail-open defaults | If check engine errors, log + notify but don't block the pipeline silently |

---

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│              Interfaces                            │
│  Terminal (Zach)  │  Dashboard UI  │  Webhooks     │
└────────┬──────────┴───────┬────────┴──────┬───────┘
         │                  │               │
┌────────▼──────┐  ┌───────▼───────┐  ┌────▼────────────┐
│  Claude Chat  │  │ Check Engine  │  │  Check Engine   │
│  /api/chat    │  │ /api/reviews  │  │  (same routes)  │
└────────┬──────┘  └───────┬───────┘  └────┬────────────┘
         │                 │               │
┌────────▼─────────────────▼───────────────▼────────┐
│              Shared Data Layer                     │
│  HubSpot client · Planset files · Tasks API       │
│  ProjectReview table · Gmail notifications        │
└───────────────────────────────────────────────────┘
```

- **Check Engine** — deterministic functions, <1s execution, used by action buttons + pipeline webhooks
- **Claude Chat** — `/api/chat` with Claude API + tools, used by chat widget + terminal
- **Shared Data Layer** — HubSpot, Prisma, planset fetching, Gmail — both systems use the same clients

---

## Section 1: Check Engine

Each skill becomes a set of check functions. A check is a pure function: takes deal data in, returns findings out.

### File Structure

```
src/lib/checks/
├── design-review.ts      # 8-12 checks derived from design-reviewer SKILL.md
├── engineering-review.ts  # structural, electrical, code compliance checks
├── sales-advisor.ts       # pricing, proposal completeness, margin checks
├── types.ts              # CheckResult, Finding, Severity types
└── index.ts              # registry: skill name → check array
```

### Core Types

```ts
type CheckFn = (context: ReviewContext) => Promise<Finding | null>

interface ReviewContext {
  dealId: string
  properties: Record<string, string>  // HubSpot deal properties
  associations?: {                     // lazily loaded as needed
    contacts?: HubSpotContact[]
    lineItems?: HubSpotLineItem[]
    files?: string[]                   // attached file names
  }
}

interface Finding {
  check: string            // "site-survey-uploaded"
  severity: "error" | "warning" | "info"
  message: string          // "Site survey PDF missing from deal attachments"
  field?: string           // HubSpot property name if relevant
}

interface ReviewResult {
  skill: string
  dealId: string
  findings: Finding[]
  errorCount: number
  warningCount: number
  passed: boolean          // true if zero errors
  durationMs: number
}
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/reviews/run` | POST | Run all checks for a skill + deal. Saves to `ProjectReview`, creates HubSpot task if errors found. Body: `{ dealId, skill, trigger? }` |
| `/api/reviews/[dealId]` | GET | All reviews for a deal, grouped by skill. Query: `?skill=design-review` optional |
| `/api/reviews/[dealId]/latest` | GET | Most recent review per skill for a deal |

### Who Calls What

- **Action button** ("Run Design Review") → `POST /api/reviews/run { trigger: "manual" }`
- **Pipeline webhook** (deal enters "Design Complete") → `POST /api/reviews/run { trigger: "webhook" }`
- **Dashboard review page** → `GET /api/reviews/[dealId]`

### Adding a New Check

Write a function, add it to the skill's check array in the registry, deploy. No SKILL.md editing needed — the engine is the source of truth for automated checks.

---

## Section 2: Claude Chat

Single `/api/chat` route that handles both entry points (project-scoped from cards, general from header).

### Request Flow

```
User message + optional dealId
        │
        ▼
  POST /api/chat
        │
        ├─ Build system prompt (role-aware: designer sees design context,
        │   sales sees sales context, based on session user's role)
        │
        ├─ If dealId provided: inject deal summary as context
        │
        ├─ Claude API with tool-use:
        │   Tools:
        │     get_deal(dealId)
        │     get_review_results(dealId, skill)
        │     search_deals(query)
        │     get_jurisdiction_rules(county)
        │     lookup_product(query)
        │
        └─ Stream response back to client via SSE
```

### Capabilities

**Can do:**
- Answer questions about a specific project ("why did design review flag setbacks?")
- Look up product specs (reuses existing product-lookup reference files)
- Explain review findings in plain language
- Search across deals ("which projects in Jefferson County are in design?")

**Cannot do:**
- Run checks (user clicks the action button — chat doesn't trigger the engine)
- Modify deal data (read-only tools only)
- Skip auth (same `requireApiAuth()` + role checks as all other routes)

### Model Selection

- **Claude Haiku** — simple lookups, FAQ-style questions
- **Claude Sonnet** — complex reasoning, multi-tool analysis
- Route decides based on whether tools are likely needed (heuristic: if dealId provided or question references a project, use Sonnet)

### Rate Limiting

Reuse existing pattern from `src/lib/ai.ts`: 10 req/min/user sliding window. Applied at route level.

---

## Section 3: Dashboard UI

Three new UI components integrated into existing dashboard patterns.

### Chat Widget

- Floating button (bottom-right corner) on all dashboard pages inside `DashboardShell`
- Opens a slide-out panel (right side, ~400px wide)
- **Project-scoped**: if on a deal page, chat starts with that deal as context
- **General**: from dashboard header, no deal pre-loaded
- Message history persisted per user in `ChatMessage` table
- Streaming responses via SSE (same pattern as existing `useSSE`)

### Action Buttons

- Added to deal/project cards and detail pages
- "Run Design Review", "Run Engineering Review", "Run Sales Check"
- **Visible based on user role**: designers see design review, sales sees sales check
- Click → `POST /api/reviews/run` → loading spinner → results in slide-out panel
- If errors found: red badge on button, findings listed with severity icons

### Review Page

- `/dashboards/reviews/[dealId]` — dedicated page for review history
- All reviews for a deal, grouped by skill
- Each finding: severity icon, message, timestamp, who triggered it (user or webhook)
- History tab: past reviews with diff ("3 issues → 1 issue remaining")
- Uses `DashboardShell`, theme tokens, `MetricCard` for summary stats at top

### No New Patterns

Everything uses existing:
- `DashboardShell` wrapper with `accentColor` prop
- `MetricCard` / `StatCard` for review summary stats
- Theme tokens (`bg-surface`, `text-foreground`, `border-t-border`, etc.)
- `useSSE` for real-time updates when a review completes
- `stagger-grid` for animated grid entry

---

## Section 4: Pipeline Automation (Webhooks)

Reuses the existing webhook pattern from `src/app/api/webhooks/hubspot/design-complete/route.ts`.

### New Webhook Routes

```
src/app/api/webhooks/hubspot/
├── design-complete/route.ts    # existing — triggers BOM pipeline
├── design-review/route.ts      # NEW — runs design checks on stage enter
├── engineering-review/route.ts  # NEW — runs engineering checks
└── sales-review/route.ts       # NEW — runs sales checks on proposal stage
```

### Webhook Flow

```
HubSpot workflow fires webhook
        │
        ▼
  Signature validation + dedup lock (existing pattern)
        │
        ▼
  waitUntil() background:
    1. Run check engine (e.g. design-review checks)
    2. Save results to ProjectReview table
    3. If errors found:
       a. Create HubSpot task assigned to deal owner
       b. Send Gmail notification to deal owner
       c. Invalidate SSE cache → dashboard shows red flag
    4. If clean:
       a. Log success, no blocking action
```

### "Block + Notify" Behavior

The webhook does not literally block the pipeline (HubSpot workflows can't be paused mid-execution). Instead:
- HubSpot task is created with findings summary
- Gmail notification sent to deal owner
- Dashboard shows red flag via SSE cache invalidation
- Optional: HubSpot workflow rule prevents stage advancement if open review task exists (configured in HubSpot, not code)

### Gmail Notifications

Via Google Gmail API (already configured in the project). Template:

```
Subject: Design review for PROJ-9015 found 3 issues
Body: [findings summary] — View in dashboard: [link to /dashboards/reviews/PROJ-9015]
```

---

## Section 5: Data Model

Two new Prisma models. No changes to existing tables.

### ProjectReview

```prisma
model ProjectReview {
  id           String   @id @default(cuid())
  dealId       String               // HubSpot deal ID
  projectId    String?              // PROJ-XXXX (extracted from deal)
  skill        String               // "design-review" | "engineering-review" | "sales-advisor"
  trigger      String               // "manual" | "webhook" | "scheduled"
  triggeredBy  String?              // user email, or "system" for webhooks
  findings     Json                 // Finding[] array
  errorCount   Int      @default(0)
  warningCount Int      @default(0)
  passed       Boolean  @default(false)
  durationMs   Int?                 // execution time
  createdAt    DateTime @default(now())

  @@index([dealId, skill])
  @@index([createdAt])
  @@index([skill, passed])
}
```

### ChatMessage

```prisma
model ChatMessage {
  id        String   @id @default(cuid())
  userId    String               // next-auth user ID
  dealId    String?              // null for general chat
  role      String               // "user" | "assistant"
  content   String
  model     String?              // "haiku" | "sonnet"
  createdAt DateTime @default(now())

  @@index([userId, dealId])
  @@index([createdAt])
}
```

---

## Section 6: Auth & Permissions

No new roles. Maps skills to existing `UserRole` enum.

### Role → Skill Access

| Action | Allowed Roles |
|--------|--------------|
| Run Design Review | ADMIN, OWNER, MANAGER, DESIGNER, OPERATIONS_MANAGER |
| Run Engineering Review | ADMIN, OWNER, MANAGER, TECH_OPS, OPERATIONS_MANAGER |
| Run Sales Check | ADMIN, OWNER, MANAGER, SALES |
| Chat widget | All authenticated users |
| View review results | All authenticated users |
| Webhook triggers | `API_SECRET_TOKEN` (machine-to-machine, existing pattern) |

### Auth Flow

- All API routes use `requireApiAuth()` from `src/lib/api-auth.ts`
- Role checks via `canAccessRoute()` from `src/lib/role-permissions.ts` or inline role checks
- `ANTHROPIC_API_KEY` stored in Vercel env vars — never exposed to client
- All Claude API calls happen server-side

### Rate Limits

| Route | Limit |
|-------|-------|
| `/api/chat` | 10 req/min/user (existing ai.ts pattern) |
| `/api/reviews/run` | No limit (deterministic, fast) |
| Webhooks | Dedup lock (existing pattern, one run per deal per trigger) |

---

## Migration from OpenAI

The existing `src/lib/ai.ts` uses OpenAI (`gpt-4o-mini`) for two routes:
- `/api/ai/anomalies` — pipeline anomaly detection
- `/api/ai/nl-query` — natural language to filter spec

These will be migrated to Claude as part of this work. The `ai.ts` module will be refactored to use the Anthropic SDK with the same rate limiter, role guard, and Zod schemas.

---

## Cost Estimate

At ~200 reviews/month via check engine: $0/mo AI cost (deterministic).
Chat usage (~50-100 messages/day across team): ~$5-10/mo Claude API.
Total: **~$5-10/mo** — well under the threshold where caching or optimization matters.

---

## What This Does NOT Cover

- **PandaDoc integration** — future work, needs API key from team
- **Scheduled reviews** — could add cron-based checks later, but manual + webhook covers the 80% case
- **Multi-tenant** — this is a single-org tool, no tenant isolation needed
- **File analysis** — check engine validates metadata (file exists, property set); deep content analysis (reading planset PDFs) stays in terminal skills for now
