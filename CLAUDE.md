# PB Operations Suite

Solar operations dashboard for Photon Brothers — HubSpot deals, Zuper field service, scheduling, and real-time metrics.

## Tech Stack

- **Framework**: Next.js 16.1, React 19.2, TypeScript 5
- **Styling**: Tailwind v4 with CSS variable tokens
- **Database**: Prisma 7.3 on Neon Postgres
- **Auth**: next-auth v5 (Google OAuth)
- **APIs**: HubSpot (CRM/deals), Zuper (field service jobs), Resend (email)
- **Real-time**: Server-Sent Events via `/api/stream` + `useSSE` hook
- **Video**: Remotion for generated video content
- **Deploy**: Vercel

## Build & Run

```bash
npm run dev          # Local dev server
npm run build        # prisma generate && next build
npm run test         # Jest tests
npm run lint         # ESLint (flat config, core-web-vitals + typescript)
npm run preflight    # Pre-deploy checks
```

Requires `.env` with DATABASE_URL, HUBSPOT_ACCESS_TOKEN, ZUPER_API_KEY, GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_SECRET. See `.env.example`.

## Project Structure

```
src/
├── app/
│   ├── api/              # 15+ API route groups (zuper/, deals/, projects/, etc.)
│   ├── dashboards/       # 30+ dashboard pages
│   └── globals.css       # Theme CSS variables + animations
├── components/
│   ├── DashboardShell.tsx # Wraps ALL dashboard pages
│   └── ui/MetricCard.tsx  # StatCard, MiniStat, MetricCard, SummaryCard
├── contexts/ThemeContext.tsx
├── hooks/useSSE.ts       # Real-time SSE with exponential backoff
├── lib/
│   ├── hubspot.ts        # HubSpot API client with rate-limit retry
│   ├── zuper.ts          # Zuper API types and helpers
│   ├── types.ts          # RawProject → TransformedProject normalization
│   └── role-permissions.ts
└── __tests__/
prisma/schema.prisma       # 680 lines, 10 UserRole enums
```

## Key Patterns

### Dashboard Pages

Every dashboard wraps content in `<DashboardShell>`:
```tsx
<DashboardShell
  title="Page Name"
  accentColor="orange"  // orange|green|red|blue|purple|emerald|cyan|yellow
  lastUpdated={data?.lastUpdated}
  exportData={{ data: rows, filename: "export.csv" }}
  fullWidth={true}      // optional, uses viewport instead of max-w-7xl
>
```

### Theme System

CSS variables in `globals.css` — **no runtime CSS injection**.

| Token | Usage |
|-------|-------|
| `bg-background` | Page background |
| `bg-surface` | Card/panel backgrounds |
| `bg-surface-2` | Nested/secondary surfaces |
| `bg-surface-elevated` | Modals, popovers |
| `text-foreground` | Primary text |
| `text-muted` | Secondary/label text |
| `border-t-border` | Borders and dividers |
| `shadow-card` | Standard card shadow |

Dark mode: `html.dark` class with radial gradient + SVG noise texture atmosphere on `body::before/::after`.

Keep `text-white` on colored buttons (orange, cyan, etc.). Remaining `bg-zinc-*` are intentional status colors.

### Metric Cards

Use components from `src/components/ui/MetricCard.tsx`:
- **StatCard**: Large accent gradient, for hero metrics
- **MiniStat**: Compact centered, for summary rows
- **MetricCard**: Flexible with border accent, for detail grids
- **SummaryCard**: Minimal, for simple key-value display

All use `key={String(value)}` + `animate-value-flash` for value-change animation.

### Real-time Data

```tsx
const { connected } = useSSE(() => refetchData(), {
  url: "/api/stream",
  cacheKeyFilter: "projects",
});
```

Exponential backoff: 1s → 2s → 4s → 8s → 16s, capped at 30s. Max 10 retries.

### Data Normalization

HubSpot raw deals (`RawProject`, camelCase) → `TransformedProject` (snake_case) via transforms in `src/lib/transforms.ts`.

### API Error Handling

HubSpot and Zuper clients use rate-limit retry with exponential backoff. See `searchWithRetry()` in `hubspot.ts`.

### User Roles

10 roles defined in Prisma schema: ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS, DESIGNER, PERMITTING, VIEWER, SALES. Permission booleans override role defaults.

## Zuper Integration

- Zuper API only allows setting `assigned_to` at job CREATION time, not updates
- Custom fields differ between GET (array) and POST (object) formats
- Status is in `current_job_status`, not `status` field
- Job categories have separate status workflows
- Team UIDs and User UIDs configured via environment variables (JSON)

## Conventions

- Use `DashboardShell` for all new dashboard pages
- Use theme tokens (`bg-surface`, `text-foreground`, etc.) — never hardcode colors
- Use `stagger-grid` CSS class for animated grid entry
- Keep `.env` files out of commits — secrets managed via Vercel env vars
- ESLint flat config: `eslint-config-next/core-web-vitals` + `typescript`
- Prisma output goes to `src/generated/prisma`
