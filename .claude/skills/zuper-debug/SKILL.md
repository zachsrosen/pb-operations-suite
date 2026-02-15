---
name: zuper-debug
description: Debug Zuper field service integration issues. Use when investigating Zuper API problems, job syncing, scheduling mismatches, or status comparison discrepancies.
---

## Zuper Integration Context

### API Architecture
- **Library**: `src/lib/zuper.ts` — types and helpers
- **API Routes**: `src/app/api/zuper/` — 8+ route groups:
  - `jobs/` — job CRUD and scheduling
  - `jobs/schedule/` — schedule operations
  - `status/` — job status queries
  - `status-comparison/` — HubSpot ↔ Zuper status sync
  - `availability/` — technician availability
  - `my-availability/` — self-service availability
  - `teams/` — team management
  - `linkage-coverage/` — job-deal linkage
  - `assisted-scheduling/` — AI-assisted scheduling
  - `schedule-records/` — persistent schedule data

### Key Gotchas
1. **assigned_to is CREATE-only**: Zuper API only accepts assigned_to when creating a job. Updates ignore it.
2. **Custom fields format differs**: GET returns array, POST expects object
3. **Status field**: Use `current_job_status` not `status`
4. **Category matters**: Job categories have separate status workflows — filter by category when comparing statuses
5. **Team/User UIDs**: Configured via ZUPER_TEAM_UIDS and ZUPER_USER_UIDS env vars (JSON format)

### Zuper MCP Server
The project has a Zuper MCP server configured in `.mcp.json`. Use MCP tools for:
- `list_jobs` / `get_job_details` — query live Zuper data
- `list_job_categories` — get category UIDs and status workflows
- `get_module_filters` — discover filterable fields
- `get_job_team_stats` / `get_job_stats_category` — aggregated stats

### Debugging Steps

When investigating a Zuper issue:

1. **Identify the scope**: Which API route, job category, or status is involved?
2. **Check the API route**: Read the relevant file in `src/app/api/zuper/`
3. **Check the Zuper types**: Read `src/lib/zuper.ts` for type definitions
4. **Query live data**: Use the Zuper MCP tools to inspect actual job data
5. **Compare with HubSpot**: If it's a sync issue, check the status-comparison route and `src/lib/hubspot.ts`
6. **Check the dashboard**: Read the relevant dashboard page in `src/app/dashboards/`

### Common Issues
- **Status mismatch**: HubSpot stage doesn't match Zuper status → check `status-comparison` route
- **Missing jobs**: Category filter may be wrong → verify category_uid via `list_job_categories`
- **Schedule not saving**: Check `schedule-records` API and Prisma ScheduleRecord model
- **Availability not showing**: Check team UID mapping in env vars
