---
name: new-dashboard
description: Scaffold a new dashboard page with DashboardShell, data fetching, and metric cards. Use when creating a new dashboard.
disable-model-invocation: true
---

## Scaffold a New Dashboard

Create a new dashboard page: `$ARGUMENTS`

### Steps

1. **Parse the argument** to determine:
   - Dashboard name (e.g., "workforce" or "Workforce Tracker")
   - Slug (kebab-case, e.g., "workforce-tracker")
   - Component name (PascalCase, e.g., "WorkforceTrackerPage")

2. **Create the page** at `src/app/dashboards/{slug}/page.tsx` using the template in [templates/page.tsx.template](templates/page.tsx.template)

3. **Customize the template**:
   - Replace `{{PageName}}` with the PascalCase component name
   - Replace `{{title}}` with the human-readable title
   - Replace `{{slug}}` with the kebab-case slug
   - Choose an appropriate `accentColor` from: orange, green, red, blue, purple, emerald, cyan, yellow
   - Set up the API endpoint based on the dashboard's data needs

4. **Ask the user** what data this dashboard needs:
   - HubSpot deals/projects? (use `/api/projects`)
   - Zuper jobs? (use `/api/zuper/jobs`)
   - Custom API? (create route in `src/app/api/`)
   - What metric cards to show?
   - Any filters needed (location, stage, date)?

5. **Add to navigation** if needed — check which suite this belongs to (Operations, Department, Executive, Admin) and update the relevant suite page.

### Conventions (from CLAUDE.md)
- Always wrap in `<DashboardShell>`
- Use theme tokens (`bg-surface`, `text-foreground`, etc.)
- Use `StatCard`/`MiniStat`/`MetricCard` from `@/components/ui/MetricCard`
- Use `useActivityTracking()` for page view tracking
- Use `useSSE()` for real-time updates if the data changes frequently
- Use `stagger-grid` CSS class for animated grid entry
- Use `key={String(value)}` on metric values for flash animation
