"use client";

import Link from "next/link";

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  changes: {
    type: "feature" | "improvement" | "fix" | "internal";
    text: string;
  }[];
}

const UPDATES: UpdateEntry[] = [
  {
    version: "1.48.0",
    date: "2026-02-17",
    title: "Survey Notifications & Google Calendar Sync",
    description: "Site survey assignments now use stronger recipient resolution for notification delivery, and optional Google Calendar sync can write survey events to either each surveyor’s primary calendar or a shared team calendar.",
    changes: [
      { type: "fix", text: "Survey notification recipient lookup now falls back from crew name to Zuper user UID and direct Zuper user email resolution" },
      { type: "fix", text: "Tentative confirm notification flow now uses the same fallback email resolution logic to reduce missed surveyor emails" },
      { type: "feature", text: "Added Google Calendar upsert for site surveys on direct schedule and tentative confirm flows" },
      { type: "feature", text: "Calendar sync supports shared calendar routing via GOOGLE_SITE_SURVEY_CALENDAR_ID (defaults to primary calendar when unset)" },
      { type: "improvement", text: "Calendar event writes are idempotent per project/deal to avoid duplicate events when rescheduling" },
      { type: "internal", text: "Google Calendar sync is feature-flagged via GOOGLE_CALENDAR_SYNC_ENABLED and logs warnings without blocking scheduling on sync failure" },
    ],
  },
  {
    version: "1.47.0",
    date: "2026-02-17",
    title: "Master Tentative Confirm Reliability & Drag State Fixes",
    description: "Master scheduler tentative confirmations are now resilient after refresh/state drift, stale tentative records are cleaned up more aggressively, and drag-reschedule UI state no longer gets stuck dimmed.",
    changes: [
      { type: "fix", text: "Master tentative confirm/cancel now fallback to DB lookup when local tentative record ID is missing" },
      { type: "fix", text: "Master drag interactions now reset visual drag state reliably so scheduled cards do not remain greyed after drag/drop" },
      { type: "fix", text: "Tentative record creation now cancels prior tentative records for the same project + schedule type to prevent stale rehydration" },
      { type: "fix", text: "Tentative confirm now cancels older tentative siblings for the same project + schedule type after successful sync" },
      { type: "fix", text: "Construction and Inspection tentative confirm/cancel now resolve record IDs from both in-memory map and rehydrated project state" },
      { type: "improvement", text: "Master tentative rehydration now prefers DB-backed tentative state over stale in-memory tentative entries" },
    ],
  },
  {
    version: "1.46.0",
    date: "2026-02-16",
    title: "HubSpot Schedule Write Verification & Site Surveyor Reliability",
    description: "Survey scheduling now verifies HubSpot writes after scheduling/confirming and uses stronger resolution logic for site surveyor updates to reduce silent drift between UI and CRM.",
    changes: [
      { type: "fix", text: "Direct schedule and confirm flows now perform HubSpot read-after-write verification for schedule date fields" },
      { type: "fix", text: "Schedule APIs now return hubspotWarnings when date/surveyor writes do not persist, instead of silently succeeding" },
      { type: "fix", text: "site_surveyor updates now resolve selected user names to HubSpot-valid owner/property values before writing" },
      { type: "improvement", text: "Surveyor write path now uses fallback behavior when mapping data is incomplete, with explicit warning logs" },
    ],
  },
  {
    version: "1.45.0",
    date: "2026-02-16",
    title: "Tentative Confirm Safety, Sync Mode Clarity, and Test Slot Access Hardening",
    description: "Tentative confirmations now fail safely when Zuper sync fails, scheduler modals now clearly label live-vs-tentative behavior, and test-slot usage is locked down to admins only.",
    changes: [
      { type: "fix", text: "Tentative confirm now stays tentative when Zuper sync fails, instead of marking scheduled with a warning" },
      { type: "fix", text: "Confirm API now returns failure on Zuper sync errors so UI does not clear tentative state incorrectly" },
      { type: "improvement", text: "All scheduler modals now show explicit mode messaging: live sync vs tentative-only (sync on confirm)" },
      { type: "fix", text: "Test slot UI is now visible only to ADMIN users" },
      { type: "fix", text: "Server-side test mode enforcement added so non-admin API requests cannot use test slot mode" },
      { type: "fix", text: "Unschedule status field mapping aligned to HubSpot internal names for construction and inspection status updates" },
    ],
  },
  {
    version: "1.44.0",
    date: "2026-02-16",
    title: "Cross-Scheduler Unschedule Parity & Tentative Workflow Completion",
    description: "Scheduling flows are now consistent across Master, Construction, and Inspection dashboards, with typed unschedule support, tentative confirm/cancel parity, timezone carry-through, and corrected HubSpot schedule field updates.",
    changes: [
      { type: "feature", text: "Unschedule API now supports typed removals for survey, installation, and inspection schedules in one endpoint" },
      { type: "fix", text: "Construction Scheduler 'Remove' now performs real backend unschedule sync (Zuper + HubSpot), not local-only removal" },
      { type: "fix", text: "Inspection Scheduler 'Remove' now performs real backend unschedule sync (Zuper + HubSpot), not local-only removal" },
      { type: "feature", text: "Construction and Inspection schedulers now rehydrate tentative records and support in-modal Confirm & Cancel actions" },
      { type: "improvement", text: "Master Scheduler detail modal now includes Remove from Schedule action for confirmed schedules" },
      { type: "fix", text: "Tentative schedule timezone now passes through from Site Survey and Inspection schedulers to prevent time drift on confirm" },
      { type: "fix", text: "Tentative confirm now writes canonical HubSpot schedule date properties for survey, construction, and inspection flows" },
    ],
  },
  {
    version: "1.43.0",
    date: "2026-02-16",
    title: "Site Survey Unschedule Hardening & Calendar Consistency",
    description: "Unschedule behavior is now hardened across Zuper + HubSpot, with stronger verification and improved scheduler behavior when external integrations write stale dates.",
    changes: [
      { type: "fix", text: "Unschedule endpoint now verifies Zuper clear + unassignment and returns partial failure when either Zuper or HubSpot clear does not complete" },
      { type: "fix", text: "HubSpot unschedule flow now retries schedule-date clear operations with verification checks to reduce integration race failures" },
      { type: "fix", text: "Site Survey Scheduler now treats 'Ready to Schedule' deals as unscheduled even when a stale schedule date exists, preventing false calendar placement" },
      { type: "improvement", text: "Remove action label standardized to 'Remove from Schedule' in survey scheduling modal" },
      { type: "improvement", text: "Unschedule action now provides clearer warning messaging when backend clear is partial" },
    ],
  },
  {
    version: "1.42.0",
    date: "2026-02-15",
    title: "Zuper Reschedule/Unschedule Reliability Sprint",
    description: "Rescheduling and unscheduling in Site Survey scheduling received a reliability pass for assignment handling, schedule clearing, and status consistency.",
    changes: [
      { type: "fix", text: "Reschedule now unassigns prior users before applying new assignment to prevent stacked assignees in Zuper" },
      { type: "fix", text: "Unschedule now uses tenant-compatible clear behavior and stricter verification for empty schedule windows" },
      { type: "fix", text: "Due-date edge cases handled so unschedule attempts no longer silently no-op on jobs missing required date fields" },
      { type: "fix", text: "Job UID resolution hardened via cache + API lookup fallback when payload UID is missing or stale" },
      { type: "improvement", text: "Added test slot mode for scheduler testing: assigns to current user and suppresses crew notifications" },
    ],
  },
  {
    version: "1.41.0",
    date: "2026-02-15",
    title: "Security Hardening, Logging & Build Stability",
    description: "Completed multi-phase hardening pass across middleware, auth cookies, API error handling, and deployment behavior.",
    changes: [
      { type: "fix", text: "Role trust hardening: middleware now prioritizes token role and blocks client-side cookie role escalation paths" },
      { type: "fix", text: "Impersonation security tightened: admin validation added for impersonation metadata access paths" },
      { type: "fix", text: "Removed dead pb-auth cookie/session token remnants from login/verify/logout flows" },
      { type: "improvement", text: "Added request correlation IDs and expanded structured logging/observability coverage" },
      { type: "fix", text: "Vercel preview build skip logic corrected to avoid unintended deploy behavior on main" },
      { type: "internal", text: "Type safety/config updates: TS target raised, Jest thresholds added, and image remote patterns configured" },
    ],
  },
  {
    version: "1.40.0",
    date: "2026-02-14",
    title: "Compliance Analytics & Admin Testing Expansion",
    description: "Compliance and admin tooling expanded with deeper comparison views, detailed drilldowns, and improved testing coverage in the Admin Suite.",
    changes: [
      { type: "feature", text: "Compliance dashboard now includes team/category comparison views and richer failed/stale status analysis" },
      { type: "feature", text: "Compliance detail views expanded with methodology context and improved job link visibility" },
      { type: "feature", text: "Admin Testing suite expanded with additional dashboards for QC, PM, D&E, and Permitting/Interconnection validation" },
      { type: "fix", text: "Completion timing extraction in compliance flow corrected to use Zuper status history shape consistently" },
      { type: "improvement", text: "HubSpot QC metric normalization improved for duration conversion and cross-dashboard consistency" },
    ],
  },
  {
    version: "1.39.0",
    date: "2026-02-13",
    title: "Equipment Detail in Schedule Modals",
    description: "Schedule and detail modals in the Master Scheduler now show full equipment specs — brand, model, wattage, kWac, and kWh — instead of just counts.",
    changes: [
      { type: "improvement", text: "Schedule modal shows module brand, model, and wattage (e.g., 30x REC Alpha Pure 430W)" },
      { type: "improvement", text: "Schedule modal shows inverter brand, model, and kWac rating" },
      { type: "improvement", text: "Battery display now includes kWh capacity alongside brand" },
      { type: "improvement", text: "Detail modal updated with same equipment spec format" },
    ],
  },
  {
    version: "1.38.0",
    date: "2026-02-13",
    title: "Equipment Backlog — Brand & Model Display",
    description: "Equipment backlog table now shows brand names, model numbers, and per-unit specs alongside counts for modules, inverters, and batteries.",
    changes: [
      { type: "improvement", text: "Module column shows brand + model name and wattage per panel" },
      { type: "improvement", text: "Inverter column shows brand + model and kWac rating" },
      { type: "improvement", text: "Battery column shows brand + model and kWh capacity" },
      { type: "improvement", text: "Wider truncation limits (160px) for equipment brand/model text" },
    ],
  },
  {
    version: "1.37.0",
    date: "2026-02-13",
    title: "Survey Unschedule Sync & Non-Core Category Audit",
    description: "Cancelling a survey now syncs the removal to both Zuper and HubSpot. Status comparison dashboard gains a non-core category audit section.",
    changes: [
      { type: "feature", text: "Cancelling a site survey schedule now clears the Zuper job dates and HubSpot schedule property" },
      { type: "feature", text: "Zuper Status Comparison: non-core category audit identifies mismatched deals with Additional Visit or Service Visit jobs" },
      { type: "feature", text: "Audit section shows summary stats and affected deals table with category badges and HubSpot links" },
      { type: "internal", text: "Added DELETE endpoint to /api/zuper/jobs/schedule for survey unscheduling" },
      { type: "internal", text: "Added unscheduleJob() method to Zuper client" },
    ],
  },
  {
    version: "1.36.0",
    date: "2026-02-13",
    title: "Role-Filtered Search",
    description: "Global search (Cmd+K) now only shows dashboards your role has access to. Non-admin users no longer see admin-only page names in search results.",
    changes: [
      { type: "improvement", text: "Global search filters dashboard links by user role using existing permission system" },
      { type: "improvement", text: "New dashboards (Zuper Compliance, Revenue Calendar) added to search index" },
    ],
  },
  {
    version: "1.35.0",
    date: "2026-02-13",
    title: "Zuper Compliance Dashboard & Executive Revenue Calendar",
    description: "Two new dashboards: per-user compliance scorecards for Zuper field service, and a monthly revenue calendar showing daily deal value from scheduled work.",
    changes: [
      { type: "feature", text: "Zuper Compliance Dashboard — per-user on-time %, stale jobs, never-started counts, and A-F grades with weighted scoring" },
      { type: "feature", text: "Executive Revenue Calendar — monthly grid showing daily revenue from construction, D&R, and service jobs joined with HubSpot deal values" },
      { type: "feature", text: "Compliance dashboard includes expandable rows with category breakdowns and stale job links to Zuper" },
      { type: "feature", text: "Revenue calendar includes category toggles, team filters, and click-to-expand day detail panels" },
      { type: "improvement", text: "Compliance dashboard added to Admin Suite navigation" },
      { type: "improvement", text: "Revenue Calendar added to Executive Suite navigation" },
    ],
  },
  {
    version: "1.34.0",
    date: "2026-02-13",
    title: "Master Schedule — Bug Fixes & Sort Dropdown",
    description: "Fixed tentative schedules losing day count on refresh, cleaned up duplicate sidebar headers, and replaced sort toggle buttons with a compact dropdown.",
    changes: [
      { type: "fix", text: "Tentative scheduled projects now persist user-entered day count across page refresh (was resetting to 1)" },
      { type: "fix", text: "Needs Scheduling / Scheduled sub-group headers only appear when viewing survey or inspection stages exclusively" },
      { type: "fix", text: "Scheduled vs unscheduled count bar now hidden when viewing mixed stages" },
      { type: "fix", text: "Schedule modal now always uses the clicked calendar date instead of defaulting to Zuper scheduled date" },
      { type: "fix", text: "Zuper job linking now strictly matches stage category — no longer falls back to survey job for construction projects" },
      { type: "improvement", text: "Replaced sort toggle buttons (Revenue, Date, Days) with a compact sort dropdown including Location and Job Type options" },
    ],
  },
  {
    version: "1.33.0",
    date: "2026-02-13",
    title: "Master Schedule — Location Views, Smarter Filters & Label Updates",
    description: "Week and Gantt views now group by PB location instead of fictional crews. Type filters redesigned as Solar Only / Battery Only / Solar + Battery. 'Overdue' renamed to 'Incomplete'. Tentative events show user-entered day counts.",
    changes: [
      { type: "feature", text: "Week and Gantt views now group events by PB location (Westminster, Centennial, CO Springs, SLO, Camarillo)" },
      { type: "feature", text: "Tentative calendar events now display day count from user input (e.g. 'TENT 3d')" },
      { type: "improvement", text: "Type filters redesigned: 'Solar Only', 'Battery Only', 'Solar + Battery', and 'EV Charger'" },
      { type: "improvement", text: "'Overdue' renamed to 'Incomplete' across all calendar views, toggles, and revenue sidebar" },
      { type: "improvement", text: "Location rows use color-coded borders matching each office location" },
      { type: "fix", text: "Completed-past-stage projects (e.g. Close Out) no longer appear as active pipeline items in sidebar" },
    ],
  },
  {
    version: "1.32.0",
    date: "2026-02-13",
    title: "Master Schedule — Survey & Inspection Scheduling Visibility",
    description: "Added clear visual distinction between scheduled and unscheduled projects within Survey and Inspection stages. Projects needing scheduling surface first with amber indicators and group headers.",
    changes: [
      { type: "feature", text: "Sub-group headers in project queue: 'Needs Scheduling' and 'Scheduled' dividers for survey/inspection stages" },
      { type: "feature", text: "Amber 'Unsched' badge on survey/inspection project cards that lack a schedule date" },
      { type: "improvement", text: "Unscheduled survey/inspection projects sort to top of queue for visibility" },
      { type: "improvement", text: "Scheduled vs needs-scheduling count bar shown when viewing survey/inspection projects" },
    ],
  },
  {
    version: "1.31.0",
    date: "2026-02-13",
    title: "Master Schedule — Multi-Select Filters & Calendar Cleanup",
    description: "Sidebar stage and type filters are now multi-select for flexible filtering. Removed RTB and Blocked from calendar stage filters since projects in those stages aren't scheduled on the calendar. Renamed 'Inspect' to 'Inspection' across all filter labels.",
    changes: [
      { type: "improvement", text: "Left sidebar stage filter tabs are now multi-select — toggle multiple stages at once" },
      { type: "improvement", text: "Left sidebar job type filter (Solar, Battery, EV) is now multi-select" },
      { type: "improvement", text: "Removed RTB and Blocked from calendar top-bar stage filters (not applicable to calendar events)" },
      { type: "improvement", text: "Renamed 'Inspect' to 'Inspection' across all filter tabs and labels" },
      { type: "improvement", text: "Added 'Clear' button to stage filter tabs when any stages are selected" },
    ],
  },
  {
    version: "1.30.0",
    date: "2026-02-13",
    title: "Bug Report System & Admin UX Cleanup",
    description: "In-app bug reporting with email notifications to TechOps, admin ticket management dashboard, and streamlined user menu.",
    changes: [
      { type: "feature", text: "In-app bug report system: floating 'Report Bug' button on every page for all non-VIEWER users" },
      { type: "feature", text: "Bug report modal with title, description, and auto-captured page URL" },
      { type: "feature", text: "Email notifications sent to techops@photonbrothers.com on every new bug report" },
      { type: "feature", text: "Admin ticket management page at /admin/tickets with status filters, detail modal, and admin notes" },
      { type: "feature", text: "Ticket status workflow: Open → In Progress → Resolved → Closed" },
      { type: "improvement", text: "User menu simplified: replaced individual admin links with single 'Admin Suite' link" },
      { type: "improvement", text: "Bug Reports added to Admin Suite, global search, and role permissions" },
      { type: "internal", text: "New Prisma models: BugReport with BugReportStatus enum" },
      { type: "internal", text: "New activity types: BUG_REPORTED, BUG_STATUS_CHANGED" },
      { type: "internal", text: "New API routes: /api/bugs/report, /api/admin/tickets" },
    ],
  },
  {
    version: "1.29.0",
    date: "2026-02-13",
    title: "Master Schedule — Tentative Scheduling, Revenue Sidebar & UX Improvements",
    description: "Tentative scheduling now persists across page refreshes with confirm/cancel workflow. Construction revenue sidebar redesigned with tentative revenue tracking, smart row visibility, and cleaner labels. Multiple layout and filter fixes.",
    changes: [
      { type: "feature", text: "Tentative schedule events now persist across page refresh — rehydrated from database on load" },
      { type: "feature", text: "Confirm & Cancel workflow for tentative events: confirms sync to Zuper + HubSpot + email notification" },
      { type: "feature", text: "Tentative events show amber dashed styling with 'TENT' label on calendar" },
      { type: "feature", text: "Tentative revenue row in Construction Revenue sidebar (amber, weekly + monthly)" },
      { type: "feature", text: "Scheduled/Overdue/Completed toggle filters with compact checkbox UI" },
      { type: "feature", text: "Export buttons (CSV/iCal/Copy) moved to sidebar header to free calendar toolbar space" },
      { type: "improvement", text: "Revenue sidebar rows only show when data is present — no more empty dash rows" },
      { type: "improvement", text: "Revenue sidebar labels: 'Sched' → 'Scheduled', totals section also conditional" },
      { type: "improvement", text: "'Build' renamed to 'Construction' on stage filter" },
      { type: "improvement", text: "'Revenue' renamed to 'Construction Revenue' on sidebar header and collapsed label" },
      { type: "improvement", text: "'Done' renamed to 'Complete' on revenue sidebar bar chart labels" },
      { type: "fix", text: "Fixed install days off-by-one: calendar day span now inclusive (Feb 19→20 = 2 days)" },
      { type: "fix", text: "Fixed tentative construction events disappearing under Construction stage filter" },
      { type: "fix", text: "Fixed collapsed revenue sidebar reopen button position (was bottom-left, now right edge)" },
    ],
  },
  {
    version: "1.28.0",
    date: "2026-02-13",
    title: "Inventory Hub — Warehouse Management & Demand Forecasting",
    description: "Full inventory management system with stock tracking, receiving, and stage-weighted demand analysis. Three-tab dashboard covering stock levels, transactions, and procurement needs across all warehouse locations.",
    changes: [
      { type: "feature", text: "Inventory Hub dashboard with Stock Overview, Receive & Adjust, and Needs Report tabs" },
      { type: "feature", text: "Stock Overview tab: sortable inventory table with on-hand quantities, projected demand, and gap indicators (shortfall highlighting)" },
      { type: "feature", text: "Receive & Adjust tab: quick-entry form for receiving shipments, adjusting counts, returning stock, and allocating to projects with debounced project search" },
      { type: "feature", text: "Needs Report tab: stage-weighted demand analysis with health bar visualization, grouped-by-category tables, and expandable per-location detail rows" },
      { type: "feature", text: "SKU auto-sync: one-click catalog population from HubSpot projects — extracts module, inverter, battery, and EV charger data" },
      { type: "feature", text: "Transaction history table with type badges, timestamps, and project references" },
      { type: "feature", text: "CSV export of procurement needs report for purchasing workflows" },
      { type: "feature", text: "Multi-select location and equipment category filters across all tabs" },
      { type: "feature", text: "Four summary stat cards: Total SKUs, Total Units, Items Below Demand, and Locations Tracked" },
      { type: "improvement", text: "Stage weights displayed in Needs Report showing demand multipliers by pipeline position (e.g., Permit Submitted = 80%, Construction Scheduled = 95%)" },
      { type: "improvement", text: "Atomic stock updates via database transactions — prevents race conditions on concurrent adjustments" },
      { type: "improvement", text: "Inventory Hub registered in Operations Suite, global search, guide, handbook, and admin testing section" },
      { type: "internal", text: "New Prisma models: EquipmentSku, InventoryStock, StockTransaction with full indexing" },
      { type: "internal", text: "Six new API routes: /api/inventory/skus, /api/inventory/stock, /api/inventory/transactions, /api/inventory/sku-sync, /api/inventory/needs" },
      { type: "internal", text: "Role permissions updated: MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER can access /dashboards/inventory and /api/inventory" },
    ],
  },
  {
    version: "1.27.0",
    date: "2026-02-12",
    title: "Master Schedule Overhaul, Revenue Sidebar & Crew Assignment",
    description: "Major master schedule upgrade with collapsible revenue sidebar, distinct event type styling, crew assignment dropdowns, time slot pickers, and comprehensive Zuper sync improvements. Executive dashboards split into standalone pages.",
    changes: [
      { type: "feature", text: "Revenue sidebar on master schedule: weekly and monthly revenue outlook with completed/scheduled/overdue breakdown" },
      { type: "feature", text: "Surveyor and inspector dropdown selectors on master schedule — assign crew directly with Zuper auto-assignment" },
      { type: "feature", text: "Time slot picker for surveys and inspections on master schedule with explicit start/end times sent to Zuper" },
      { type: "feature", text: "Distinct event type styling: completed milestones show faded same-color, inspections distinguish pass vs. fail, overdue events get red ring indicator" },
      { type: "feature", text: "PE (Participate Energy) tags on master schedule calendar events" },
      { type: "feature", text: "Collapsible bar charts on executive dashboards for cleaner layout" },
      { type: "feature", text: "Weekday-only view toggle on master schedule calendar" },
      { type: "feature", text: "Overdue toggle filter: show/hide overdue projects across the schedule" },
      { type: "feature", text: "Zuper linkage coverage section on status comparison dashboard" },
      { type: "feature", text: "Ready To Build projects now appear in construction scheduler queue" },
      { type: "feature", text: "Suite-aware back navigation on all dashboards — returns to parent suite instead of home" },
      { type: "improvement", text: "Overdue grace period by event type: surveys, inspections, and construction each have appropriate thresholds" },
      { type: "improvement", text: "Zuper bidirectional date sync: master schedule uses Zuper scheduled time windows as source of truth" },
      { type: "improvement", text: "HubSpot internal enum values used for filter groups with proper display name mappings" },
      { type: "improvement", text: "Monthly bar charts added to main dashboard and duplicate stats removed" },
      { type: "improvement", text: "Design dashboard chart restored to dual-series DA Approved by Month format" },
      { type: "improvement", text: "Scheduler renamed to 'Schedule' across the UI for consistency" },
      { type: "improvement", text: "Activity tracking added to all schedule actions (create, reschedule)" },
      { type: "improvement", text: "Reschedule-only mode prevents accidental new scheduling from drag actions" },
      { type: "fix", text: "Fixed duplicate calendar events: Zuper dates now only used for matching job category" },
      { type: "fix", text: "Fixed install days always showing 2 — HubSpot values no longer masked by premature defaults" },
      { type: "fix", text: "Fixed Zuper job links: lookup switched from GET to POST to avoid URL length limits" },
      { type: "fix", text: "Fixed master schedule calendar day misalignment" },
      { type: "fix", text: "Fixed Zuper sync error for surveys: end date before start date when days < 1" },
      { type: "fix", text: "Fixed end date before start date in createJobFromProject for partial-day jobs" },
      { type: "fix", text: "Fixed availability override upsert preventing duplicate blocked dates" },
      { type: "fix", text: "Fixed schedule API job matching to prevent Zuper sync failures" },
      { type: "fix", text: "Fixed Zuper status comparison infinite loading state" },
      { type: "fix", text: "Fixed completed construction visibility on master schedule" },
      { type: "internal", text: "Executive Command Center split into standalone dashboard pages" },
      { type: "internal", text: "Zuper linkage API endpoint for cross-system coverage analysis" },
      { type: "internal", text: "Multi-domain auth support for scheduling API" },
      { type: "internal", text: "Zuper wider search with no-date fallback and pagination support" },
    ],
  },
  {
    version: "1.26.0",
    date: "2026-02-12",
    title: "Prototypes, SOP Documentation & Admin Suite Expansion",
    description: "Admin suite now hosts prototype pages for Solar Checkout Experience and Solar Surveyor v11, plus a new SOP documentation section. Prototypes are embedded as full-screen iframes with admin-only access.",
    changes: [
      { type: "feature", text: "Solar Checkout Experience prototype added to admin suite Testing section — embeds the full interactive checkout flow prototype" },
      { type: "feature", text: "Solar Surveyor v11 prototype added to admin suite Testing section — embeds the energy dispatch & battery simulation suite" },
      { type: "feature", text: "SOP (Standard Operating Procedures) documentation page added to admin suite Documentation section — embeds the full operations guide" },
      { type: "feature", text: "All prototype pages use full-height iframe embedding with compact nav header and 'Open in new tab' option" },
      { type: "improvement", text: "Admin suite Testing section now includes 7 items: At-Risk, Optimizer, Zuper Comparison, Mobile, PE, Solar Checkout, and Solar Surveyor" },
      { type: "improvement", text: "Admin suite Documentation section now includes 5 items: Updates, Handbook, Guide, Roadmap, and SOPs" },
      { type: "internal", text: "Static HTML prototypes served from public/prototypes/ directory" },
      { type: "internal", text: "All prototype pages enforce ADMIN-only server-side auth guard" },
    ],
  },
  {
    version: "1.25.0",
    date: "2026-02-12",
    title: "Admin Suite Reorganization & Home Page Cleanup",
    description: "Admin suite restructured into 4 sections (Admin Tools, Testing, Documentation, API Endpoints). At-risk projects and pipeline optimizer moved from executive suite to admin testing. Admin-only links removed from home page.",
    changes: [
      { type: "feature", text: "Admin suite reorganized into 4 distinct sections: Admin Tools, Testing, Documentation, and API Endpoints" },
      { type: "feature", text: "Testing section in admin suite with At-Risk Projects, Pipeline Optimizer, Zuper Status Comparison, Mobile Dashboard, and PE Dashboard" },
      { type: "feature", text: "Documentation section in admin suite with Updates, Guide, Roadmap, and Handbook" },
      { type: "feature", text: "API Endpoints section in admin suite with quick links to Projects+Stats, PE Projects, and Scheduling APIs" },
      { type: "improvement", text: "Executive suite streamlined to 3 cards: Command Center, Executive Summary, and Location Comparison" },
      { type: "improvement", text: "At-Risk Projects and Pipeline Optimizer removed from executive suite (moved to admin testing)" },
      { type: "improvement", text: "Home page cleaned up — removed Updates, Roadmap, and Guide links from header navigation" },
      { type: "improvement", text: "Command Center tabs streamlined — removed at-risk and optimizer tabs" },
      { type: "fix", text: "Removed /dashboards/at-risk from PROJECT_MANAGER allowed routes (now admin-only)" },
    ],
  },
  {
    version: "1.24.0",
    date: "2026-02-12",
    title: "Theme System Overhaul & Visual Polish",
    description: "Complete migration from hardcoded zinc colors to CSS variable-based theme tokens. New value-change animations, staggered grid entry, and dark theme atmosphere effects.",
    changes: [
      { type: "feature", text: "Value-change animation: stat cards flash briefly when their values update (animate-value-flash via key={value})" },
      { type: "feature", text: "Staggered grid entry animation: dashboard cards fade in sequentially using .stagger-grid CSS class" },
      { type: "feature", text: "Dark theme atmosphere: radial gradient glow + SVG noise texture on body::before/::after for visual depth" },
      { type: "improvement", text: "Complete migration to CSS variable theme tokens: bg-background, bg-surface, bg-surface-2, bg-surface-elevated, text-foreground, text-muted, border-t-border" },
      { type: "improvement", text: "Removed all runtime CSS injection — the old LIGHT_CSS hack in ThemeContext.tsx has been eliminated" },
      { type: "improvement", text: "Shadow tokens added: shadow-card and shadow-card-lg for consistent elevation across light/dark themes" },
      { type: "improvement", text: "Skeleton loading states use bg-skeleton token for theme-aware placeholder colors" },
      { type: "fix", text: "Remaining bg-zinc-* uses are now intentional semantic status colors (toggles, badges, fallbacks) — not theme violations" },
      { type: "fix", text: "text-white preserved on buttons with colored backgrounds (orange, cyan, etc.) for proper contrast" },
    ],
  },
  {
    version: "1.23.0",
    date: "2026-02-11",
    title: "Suite Architecture, Role Consolidation & Impersonation Fixes",
    description: "Major restructuring of the app into suite-based navigation (Operations, Department, Executive, Admin). Consolidated user roles, fixed impersonation routing bugs, and added extensive new dashboards and admin tools.",
    changes: [
      { type: "feature", text: "Suite-based navigation: Operations Suite, Department Suite, Executive Suite, Admin Suite, and Additional Pipeline Suite" },
      { type: "feature", text: "Executive Suite with Command Center, Executive Summary, and Location Comparison dashboards" },
      { type: "feature", text: "Zuper Status Comparison dashboard — compare Zuper job statuses and dates with HubSpot deal data" },
      { type: "feature", text: "Zuper user/team sync API endpoint for bulk synchronizing Zuper crew data" },
      { type: "feature", text: "Global page-view logging: every dashboard visit tracked with automatic activity logging" },
      { type: "feature", text: "OWNER role added — full access like ADMIN but without user management permissions" },
      { type: "feature", text: "New roles: TECH_OPS, PROJECT_MANAGER, OPERATIONS_MANAGER with granular route and permission controls" },
      { type: "feature", text: "Unassigned users (VIEWER role) see contact prompt instead of blank dashboard" },
      { type: "feature", text: "Handbook page with comprehensive guide to all dashboards, features, and workflows" },
      { type: "feature", text: "Milestone Revenue Breakdown in Command Center with weekly/monthly toggle and per-milestone bar charts" },
      { type: "feature", text: "Backlog Forecasted Revenue section with stage and location breakdowns, expandable per-month detail" },
      { type: "feature", text: "Design Approvals milestone tracking added to Command Center capacity view" },
      { type: "improvement", text: "Role consolidation: MANAGER → PROJECT_MANAGER, DESIGNER/PERMITTING → TECH_OPS via normalizeRole()" },
      { type: "improvement", text: "Project Managers can see both Operations and Department suites on home page" },
      { type: "improvement", text: "SALES users route directly to Site Survey Scheduler on login" },
      { type: "improvement", text: "OPERATIONS and OPERATIONS_MANAGER users route directly to Operations Suite" },
      { type: "improvement", text: "TECH_OPS users route directly to Department Suite" },
      { type: "improvement", text: "Zuper Status Comparison: multi-select PB location filter and scheduled-start date windowing" },
      { type: "improvement", text: "Zuper Status Comparison: match by HubSpot Deal ID for accurate cross-system linking" },
      { type: "improvement", text: "Command Center: calendar completed events display and tentative schedule persistence" },
      { type: "improvement", text: "Inspection scheduling: uses 8am-4pm window with activity logging on schedule actions" },
      { type: "improvement", text: "Director auto-assignment on executive suite access for streamlined routing" },
      { type: "fix", text: "Fixed impersonation exit trapping user in department suite — now navigates to / instead of reload" },
      { type: "fix", text: "Fixed userRole defaulting to TECH_OPS before auth sync, causing premature redirect to department suite" },
      { type: "fix", text: "Fixed PROJECT_MANAGER missing / in allowedRoutes — middleware was redirecting PMs away from home page" },
      { type: "fix", text: "Fixed canAccessRoute: '/' in allowedRoutes no longer matches all routes via startsWith (exact match for root)" },
      { type: "fix", text: "Fixed impersonation cookie sync: effective role cookie now updates on both start and stop" },
      { type: "fix", text: "Fixed middleware blocking impersonation API route — added bypass for /api/admin/impersonate" },
      { type: "fix", text: "Disabled service worker and cleared stale PB caches to prevent navigation to deleted dashboard routes" },
      { type: "fix", text: "Fixed false admin redirect on Zuper comparison page" },
      { type: "fix", text: "Fixed stale dashboard navigation from service worker cache serving outdated pages" },
      { type: "fix", text: "Fixed env validator typing for auth secret fallback" },
      { type: "fix", text: "Hardened runtime security and stabilized SSE/logging behavior" },
      { type: "fix", text: "Fixed stream TTL cleanup to prevent memory leaks on long-running SSE connections" },
      { type: "internal", text: "Prisma migration for 7 missing UserRole enum values (OWNER, TECH_OPS, PROJECT_MANAGER, OPERATIONS_MANAGER, etc.)" },
      { type: "internal", text: "pb_effective_role cookie bridges DB role to edge middleware for role-based routing" },
      { type: "internal", text: "Zuper MCP server configuration added for AI-assisted Zuper operations" },
      { type: "internal", text: "All /admin routes restricted to ADMIN-only access at middleware level" },
      { type: "internal", text: "Mismatch audit for additional/service Zuper categories" },
      { type: "internal", text: "Removed favorites feature and fixed unclickable dashboard cards" },
    ],
  },
  {
    version: "1.22.1",
    date: "2026-02-10",
    title: "Inspection Scheduler Overhaul, Crew Teams & Availability Enhancements",
    description: "Major inspection scheduler upgrade with crew/slot selection and rescheduling. New crew teams (DTC & Westminster), Daniel Kelly added as inspection crew, AM/PM time display, single-date blocking, and seed data improvements.",
    changes: [
      { type: "feature", text: "Inspection scheduler crew/slot selection: pick specific inspectors and time slots when scheduling inspections" },
      { type: "feature", text: "Inspection scheduler rescheduling: reschedule existing inspections directly from the calendar with updated crew and slot" },
      { type: "feature", text: "Inspection scheduler now shows address and inspector columns for better visibility" },
      { type: "feature", text: "Inspection scheduler supports past-date viewing and slot display" },
      { type: "feature", text: "DTC & Westminster crew teams added with automatic Zuper UID resolution" },
      { type: "feature", text: "Daniel Kelly added as inspection crew member at DTC location" },
      { type: "feature", text: "AM/PM time display across all scheduling interfaces for clearer time selection" },
      { type: "feature", text: "Single-date availability blocking: block individual dates for crew members instead of only date ranges" },
      { type: "feature", text: "Seed Teams button on admin crew availability page for quick database population" },
      { type: "feature", text: "Security hardening with revenue dashboard protections, calendar filters, and tentative scheduling persistence" },
      { type: "improvement", text: "Seed button now creates crew members first, then availability records — correct dependency order" },
      { type: "improvement", text: "Sync from Code button always visible on admin availability page regardless of existing data" },
      { type: "fix", text: "Fixed overdue indicator showing incorrectly when a re-inspection has already passed" },
      { type: "fix", text: "Fixed Zuper job matching for PROJ-numbered projects with common customer names (disambiguation)" },
      { type: "fix", text: "Fixed seed functionality creating availability records before crew members existed" },
    ],
  },
  {
    version: "1.22.0",
    date: "2026-02-10",
    title: "Surveyor Self-Service, SALES Scheduling Controls & Design Clipping",
    description: "Surveyors can manage their own availability, SALES users restricted from next-day scheduling, inverter clipping detection added to design dashboard, crew availability management UI, and comprehensive Zuper calendar accuracy improvements.",
    changes: [
      { type: "feature", text: "Surveyor self-service availability: crew members can view and update their own schedules directly from the Site Survey Scheduler via \"My Availability\" button" },
      { type: "feature", text: "Design dashboard clipping detection tool: analyzes DC/AC ratios with seasonal TSRF decomposition, battery mitigation factors, and risk-level classification for inverter clipping" },
      { type: "feature", text: "SALES role scheduling restriction: SALES users cannot schedule surveys for tomorrow, enforcing a minimum 2-day lead time" },
      { type: "feature", text: "Crew availability management UI: admin page for managing crew schedules with Zuper sync integration" },
      { type: "feature", text: "\"Manage Availability\" admin link added to scheduler toolbar for quick access to crew availability management" },
      { type: "fix", text: "Admin impersonation now works correctly with self-service availability (crew member lookup uses impersonated user's email)" },
      { type: "fix", text: "Zuper DB cache now includes scheduled dates, assigned surveyors, and job status for accurate survey calendar display" },
      { type: "fix", text: "Zuper slot matching improved: uses job UID resolution and correctly handles unassigned jobs" },
      { type: "fix", text: "Zuper-sourced bookings now separated from persistent in-memory Map to prevent stale calendar data" },
      { type: "fix", text: "Timezone-aware slot keys with correct job status and HubSpot Deal ID extraction for Zuper sync" },
      { type: "fix", text: "Zuper scheduled date used as source of truth for calendar placement instead of HubSpot close date" },
      { type: "fix", text: "Fixed Zuper API endpoint and payload for user assignment (dynamic UID resolution)" },
      { type: "internal", text: "Crew member email linking via firstname@photonbrothers.com convention for automatic user-to-surveyor mapping" },
    ],
  },
  {
    version: "1.21.0",
    date: "2026-02-10",
    title: "Dashboard Separation, Equipment Expansion & Admin Upgrades",
    description: "Inspections split into its own dashboard, equipment backlog expanded with location & value data, enhanced activity logging with analytics, and improved user permission management.",
    changes: [
      { type: "feature", text: "New standalone Inspections dashboard with pass rates, AHJ analysis, status tracking, and dedicated inspection filters" },
      { type: "feature", text: "Equipment Backlog: location breakdown table showing kW DC/AC, modules, inverters, batteries, and value per location" },
      { type: "feature", text: "Equipment Backlog: expanded stage breakdown with kW AC, inverters, batteries, and kWh columns" },
      { type: "feature", text: "Equipment Backlog: module wattage and inverter kW AC details in brand/model breakdown" },
      { type: "feature", text: "Activity Log: date range filters (Today, 7 Days, 30 Days, All), email search, and activity type summary cards" },
      { type: "feature", text: "Activity Log: CSV export of filtered activity data" },
      { type: "feature", text: "Activity Log: auto-refresh toggle for real-time monitoring" },
      { type: "feature", text: "User Management: search/filter users by name, email, or role" },
      { type: "feature", text: "User Management: bulk role updates with multi-select checkboxes" },
      { type: "feature", text: "User Management: last active indicator (green/yellow/red) with relative timestamps" },
      { type: "feature", text: "User Management: permission audit trail showing recent role/permission changes" },
      { type: "feature", text: "User Management: new canScheduleInspections permission flag" },
      { type: "improvement", text: "Permitting dashboard streamlined to permit-only data (inspections moved to dedicated dashboard)" },
      { type: "improvement", text: "Equipment Backlog: pipeline value stat card and expanded projects table with kW AC and value columns" },
      { type: "improvement", text: "Activity Log: formatted metadata display for dashboard views, schedules, and searches" },
      { type: "improvement", text: "User Management: user count summary with admin and active user counts" },
      { type: "fix", text: "HubSpot project fetch now uses two-phase approach (ID search + batch read) to load all ~710 active projects reliably" },
      { type: "fix", text: "Server-side stage filtering excludes inactive deals at HubSpot API level for faster cache performance" },
      { type: "internal", text: "Separate cache keys for active vs all projects to optimize cache hit rates" },
      { type: "internal", text: "Inspections dashboard added to home page navigation and prefetch configuration" },
    ],
  },
  {
    version: "1.20.0",
    date: "2026-02-09",
    title: "Overdue Indicators, Multi-Day Installs & Timezone Scheduling",
    description: "Overdue project indicators across all schedulers, multi-day install display on construction scheduler, timezone-aware scheduling for California locations, and master scheduler week view fix.",
    changes: [
      { type: "feature", text: "Overdue indicators on Site Survey, Construction, and Inspection schedulers - calendar, sidebar, list view, and stats row" },
      { type: "feature", text: "Construction scheduler now shows multi-day installs spanning across business days (D1, D2, etc.)" },
      { type: "feature", text: "Install days column added to construction scheduler list view and schedule modal" },
      { type: "feature", text: "Timezone-aware scheduling for California locations (Pacific Time for Nick Scarpellino)" },
      { type: "feature", text: "Nick Scarpellino added to site survey scheduler crew roster, Rich renamed to Ryszard Szymanski" },
      { type: "improvement", text: "Site Survey Scheduler shows booked slot immediately after scheduling (optimistic UI update)" },
      { type: "improvement", text: "Construction scheduler uses actual install days from HubSpot instead of hardcoded 2 days" },
      { type: "improvement", text: "Surveyor name resolution uses Owners API for accurate display (no more numeric IDs)" },
      { type: "fix", text: "Master scheduler week view now correctly shows all days of multi-day installs (was only showing D1)" },
      { type: "fix", text: "Timezone-aware availability display for California crew members (was showing Mountain Time)" },
      { type: "fix", text: "Fixed construction status showing blank — corrected HubSpot property name mapping" },
      { type: "fix", text: "Fixed surveyor assignment display and slot blocking for jobs outside configured crew schedules" },
      { type: "fix", text: "Comprehensive code review improvements across 42 files — error handling, type safety, and edge cases" },
    ],
  },
  {
    version: "1.19.0",
    date: "2026-02-09",
    title: "Dashboard Enhancements & Zuper Improvements",
    description: "New columns across dashboards, improved Zuper job matching, surveyor tracking, and multi-select filters on the Incentives dashboard.",
    changes: [
      { type: "feature", text: "Incentives dashboard: multi-select filters for Program, Location, Stage, and Status with search bar" },
      { type: "feature", text: "Interconnection dashboard: PTO Submitted and PTO Granted date columns" },
      { type: "feature", text: "Design dashboard: Project Type and Tags columns" },
      { type: "feature", text: "Site Survey Scheduler: assigned surveyor stored locally and displayed in list view, calendar, and modal" },
      { type: "feature", text: "Customer names added to all 5 department dashboards (Construction, Site Survey, Design, Permitting, Interconnection)" },
      { type: "improvement", text: "Zuper job matching rewritten with multi-factor scoring (DB cache > Deal ID > tag > name + address)" },
      { type: "improvement", text: "Zuper job lookup prioritizes active/scheduled jobs over completed ones" },
      { type: "improvement", text: "Activity logs now include assigned user name in metadata" },
      { type: "fix", text: "Fixed Zuper job linking to incorrect jobs for customers with common last names" },
      { type: "fix", text: "Fixed project name delimiter issue causing misaligned Zuper lookups (commas in customer names)" },
      { type: "fix", text: "Fixed main page 'Failed to load data' error with slim API responses and fallback" },
      { type: "fix", text: "Fixed equipment backlog missing battery-only and EV-only projects" },
      { type: "fix", text: "Increased Vercel function timeout from 30s to 60s for cold-start reliability" },
    ],
  },
  {
    version: "1.18.0",
    date: "2026-02-08",
    title: "Dynamic Status Filters & Multi-Select",
    description: "All scheduler status filters now pull values directly from HubSpot data and support multi-select.",
    changes: [
      { type: "feature", text: "Multi-select status filters on Construction, Inspection, and Site Survey schedulers" },
      { type: "improvement", text: "Status filter options are now dynamically generated from actual project data instead of hardcoded lists" },
      { type: "fix", text: "Fixed construction scheduler status filter showing inaccurate/mismatched options" },
      { type: "fix", text: "Fixed inspection scheduler status filter not matching HubSpot values" },
      { type: "fix", text: "Fixed site survey scheduler status filter with stale hardcoded values" },
    ],
  },
  {
    version: "1.17.0",
    date: "2026-02-08",
    title: "Equipment Backlog Dashboard & Location Filtering",
    description: "New equipment forecasting dashboard and interactive location filtering on the home page.",
    changes: [
      { type: "feature", text: "Equipment Backlog dashboard - equipment breakdown by brand, model, and stage with forecasting" },
      { type: "feature", text: "Multi-select PB location and deal stage filtering on Equipment Backlog" },
      { type: "feature", text: "CSV export of equipment data for procurement and forecasting" },
      { type: "feature", text: "Summary view with modules, inverters, and batteries grouped by brand/model" },
      { type: "feature", text: "Projects view with sortable table of all equipment details" },
      { type: "feature", text: "Interactive location filtering on home page - click 'Projects by Location' cards to filter all stats" },
      { type: "feature", text: "Multi-location API support - filter stats by multiple PB locations simultaneously" },
      { type: "improvement", text: "Active filter banner shows selected locations with one-click clear" },
      { type: "improvement", text: "Unselected location cards dim when filter is active for visual clarity" },
      { type: "fix", text: "Fixed location filter not applying due to React dependency loop" },
    ],
  },
  {
    version: "1.16.0",
    date: "2026-02-08",
    title: "Theme Toggle & Inspection Fix",
    description: "Dark/light theme toggle added to all remaining pages, and inspection status filter fixed.",
    changes: [
      { type: "feature", text: "ThemeToggle added to Construction Scheduler, Command Center, and Mobile dashboards" },
      { type: "feature", text: "Light theme support (dashboard-bg class) on all dashboard pages" },
      { type: "fix", text: "Fixed 'Ready For Inspection' status filter - case mismatch with HubSpot field value" },
      { type: "improvement", text: "Removed Total kW stat from home page (per request)" },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-02-08",
    title: "PWA Support & Dark/Light Theme",
    description: "Install the app on your phone or desktop, plus a new dark/light theme toggle.",
    changes: [
      { type: "feature", text: "Progressive Web App (PWA) - install PB Operations Suite on iOS, Android, and desktop" },
      { type: "feature", text: "Dark/light theme toggle with localStorage persistence" },
      { type: "feature", text: "Mobile-responsive scheduler views - all schedulers optimized for phone screens" },
      { type: "improvement", text: "Runtime CSS injection for theme support (bypasses Tailwind v4 PostCSS limitations)" },
      { type: "improvement", text: "Service worker for offline caching and faster load times" },
      { type: "internal", text: "Web app manifest with icons for Add to Home Screen" },
      { type: "fix", text: "Dependency vulnerabilities patched - Next.js 16.1.4 → 16.1.6, tar updated" },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-02-07",
    title: "Admin User Impersonation",
    description: "Admins can now log in as any user to review functionality and troubleshoot issues.",
    changes: [
      { type: "feature", text: "User impersonation - admins can 'View As' any non-admin user from User Management" },
      { type: "feature", text: "Impersonation banner - orange banner shows when viewing as another user with quick exit button" },
      { type: "feature", text: "Full impersonation audit trail - all impersonation start/stop events logged to ActivityLog" },
      { type: "improvement", text: "All dashboards and APIs respect impersonated user's role and permissions" },
      { type: "internal", text: "New API: /api/admin/impersonate for starting/stopping user impersonation" },
      { type: "internal", text: "Database field: impersonatingUserId on User model tracks active impersonation" },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-02-07",
    title: "Granular User Permissions & Roadmap Management",
    description: "Per-user permission overrides, expanded user roles, and admin roadmap status management.",
    changes: [
      { type: "feature", text: "Granular permissions modal - set per-user permission overrides (surveys, installs, Zuper sync, user management)" },
      { type: "feature", text: "Location restrictions - limit users to specific PB locations (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo)" },
      { type: "feature", text: "Roadmap admin mode - admins can mark items as Planned, In Progress, Under Review, or Completed" },
      { type: "feature", text: "Database-backed roadmap - votes and status changes persist across deployments" },
      { type: "improvement", text: "All 7 user roles now visible in admin panel (ADMIN, MANAGER, OPERATIONS, DESIGNER, PERMITTING, VIEWER, SALES)" },
      { type: "improvement", text: "Site Survey Scheduler availability display improved - shows all slots without truncation" },
      { type: "improvement", text: "Availability grouped by surveyor name with pill badges showing slot counts" },
      { type: "internal", text: "New API: /api/admin/users/permissions for granular permission updates" },
      { type: "internal", text: "Activity logging for permission changes" },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-02-07",
    title: "Security & Role-Based Access Control",
    description: "Comprehensive security improvements with granular role permissions and crew notifications.",
    changes: [
      { type: "feature", text: "Role-based scheduling permissions - control who can schedule surveys, installs, and inspections" },
      { type: "feature", text: "Scheduling notification emails - crew members receive email when scheduled for appointments" },
      { type: "feature", text: "New user roles: OPERATIONS, DESIGNER, PERMITTING with specific access controls" },
      { type: "feature", text: "CrewMember database model - secure storage for Zuper user configurations" },
      { type: "feature", text: "Admin crew management API - /api/admin/crew endpoint for crew CRUD operations" },
      { type: "improvement", text: "Security headers added to all responses (CSP, HSTS, X-Frame-Options, etc.)" },
      { type: "improvement", text: "Database-backed rate limiting - 5 requests per 15 minutes" },
      { type: "improvement", text: "API authentication enforcement in middleware" },
      { type: "internal", text: "Granular permissions: canScheduleSurveys, canScheduleInstalls, canEditDesign, etc." },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-02-06",
    title: "Dashboard Status Groups Reorganization",
    description: "Reorganized status filter groups across all dashboards for better workflow organization.",
    changes: [
      { type: "improvement", text: "Design dashboard - revision statuses grouped by type (DA, Permit, Utility, As-Built)" },
      { type: "improvement", text: "Design Approval - 'Ready' section with Ready For Review and Draft Created" },
      { type: "improvement", text: "Design Approval - 'Sent to Customer' now includes Sent to Customer status" },
      { type: "improvement", text: "Permitting - As-Built Revisions moved to Rejections & Revisions group" },
      { type: "improvement", text: "Interconnection - Xcel Site Plan & SLD moved to Special Cases" },
      { type: "improvement", text: "Construction - Scheduled & Pending NC Design Review moved to Pre-Construction" },
      { type: "improvement", text: "Construction - 'On Our Way' status moved to In Progress group" },
      { type: "improvement", text: "Site Survey - 'Needs Revisit' moved to Scheduling group" },
      { type: "fix", text: "D&R dashboard - removed unused Reset and Detach status filters" },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-02-05",
    title: "Scheduler Calendar Improvements",
    description: "All scheduler calendars now show complete event lists without truncation.",
    changes: [
      { type: "improvement", text: "Master Scheduler shows all events per day (no more '+X more' truncation)" },
      { type: "improvement", text: "Site Survey Scheduler shows all events per day" },
      { type: "improvement", text: "Construction Scheduler shows all events per day" },
      { type: "improvement", text: "Inspection Scheduler shows all events per day" },
      { type: "improvement", text: "Calendar cells now scrollable for days with many events" },
      { type: "fix", text: "Fixed Feb 5th showing '+2' instead of all scheduled projects" },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-02-05",
    title: "Activity Tracking & Database Caching",
    description: "Comprehensive activity logging and database caching for improved performance and analytics.",
    changes: [
      { type: "feature", text: "Activity tracking on all 21 dashboards" },
      { type: "feature", text: "Admin Activity Log page - view all user actions" },
      { type: "feature", text: "Zuper job caching in database for faster lookups" },
      { type: "feature", text: "HubSpot project caching for improved performance" },
      { type: "feature", text: "Schedule records stored permanently for history" },
      { type: "improvement", text: "Dashboard views, searches, and filters are now logged" },
      { type: "improvement", text: "Scheduling actions tracked with full context" },
      { type: "internal", text: "PostgreSQL database with Prisma ORM (Neon serverless)" },
      { type: "internal", text: "Activity log includes IP, user agent, and session tracking" },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-02-04",
    title: "Construction & Inspection Schedulers",
    description: "New dedicated schedulers for construction and inspection teams with full Zuper integration.",
    changes: [
      { type: "feature", text: "Construction Scheduler - dedicated calendar for scheduling construction installs" },
      { type: "feature", text: "Inspection Scheduler - dedicated calendar for scheduling inspections" },
      { type: "feature", text: "Drag-and-drop rescheduling on all scheduler calendars" },
      { type: "improvement", text: "All schedulers now support rescheduling by dragging events to new dates" },
      { type: "improvement", text: "Roadmap voting now persists across sessions" },
      { type: "fix", text: "Fixed back button navigation on scheduler pages" },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-02-04",
    title: "Zuper Job Links in Schedulers",
    description: "Direct links to Zuper jobs now appear alongside HubSpot links in both scheduler tools.",
    changes: [
      { type: "feature", text: "Zuper job links in Site Survey Scheduler list view" },
      { type: "feature", text: "Zuper job links in Master Scheduler project queue cards" },
      { type: "feature", text: "Zuper links in schedule confirmation modals" },
      { type: "feature", text: "Zuper links in project detail modals" },
      { type: "improvement", text: "Projects automatically fetch Zuper job UIDs on load" },
      { type: "internal", text: "New /api/zuper/jobs/lookup endpoint for batch job lookups" },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-02-04",
    title: "Product Roadmap & Feature Voting",
    description: "New interactive roadmap where you can vote on features and submit your own ideas.",
    changes: [
      { type: "feature", text: "Product Roadmap page - view all planned features and their status" },
      { type: "feature", text: "Feature voting - upvote the features you want to see built next" },
      { type: "feature", text: "Submit ideas - propose new features and improvements" },
      { type: "feature", text: "Filter by status (Planned, In Progress, Under Review, Completed)" },
      { type: "feature", text: "Filter by category (Performance, Features, Integrations, UX, Analytics)" },
      { type: "improvement", text: "Roadmap linked from Updates page and header navigation" },
      { type: "improvement", text: "Updated guide documentation with all recent features" },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-02-04",
    title: "Maintenance Mode & Product Updates Page",
    description: "Added deployment tools and transparency features for better communication with your team.",
    changes: [
      { type: "feature", text: "Maintenance mode page - shows 'Updates in Progress' during deployments" },
      { type: "feature", text: "Product Updates page (this page!) - changelog showing all releases" },
      { type: "feature", text: "Automatic maintenance detection - page auto-refreshes when updates complete" },
      { type: "feature", text: "ROADMAP.md file tracking planned features and priorities" },
      { type: "improvement", text: "Added 'Updates' link in header navigation" },
      { type: "internal", text: "Environment variable MAINTENANCE_MODE controls maintenance state" },
      { type: "internal", text: "Deployment webhook endpoint for Vercel integration" },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-02-04",
    title: "Multi-Select Filters & Availability Overlay",
    description: "Enhanced scheduling tools with better filtering and Zuper availability integration.",
    changes: [
      { type: "feature", text: "Multi-select location filters on Site Survey Scheduler and Master Scheduler" },
      { type: "feature", text: "Availability overlay showing technician availability from Zuper" },
      { type: "feature", text: "Calendar views filter to show only selected locations' jobs and crews" },
      { type: "feature", text: "Week and Gantt views respect location filter selections" },
      { type: "improvement", text: "Crew capacity panel updates based on selected locations" },
      { type: "improvement", text: "Green/yellow/red indicators show availability status on calendar days" },
      { type: "internal", text: "Added /api/zuper/availability endpoint combining slots, time-offs, and jobs" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-02-04",
    title: "Site Survey Scheduler & Zuper Integration",
    description: "New dedicated scheduler for site surveys with full Zuper FSM integration.",
    changes: [
      { type: "feature", text: "Site Survey Scheduler - dedicated calendar for scheduling site surveys" },
      { type: "feature", text: "Zuper FSM integration - create and schedule jobs directly in Zuper" },
      { type: "feature", text: "Drag-and-drop scheduling with automatic Zuper sync" },
      { type: "feature", text: "Assisted Scheduling API - fetch available time slots from Zuper" },
      { type: "improvement", text: "Project cards show survey status, scheduling state, and system size" },
      { type: "fix", text: "Fixed Zuper API endpoint for job scheduling (PUT /jobs/schedule)" },
      { type: "fix", text: "Fixed Zuper date format to use 'YYYY-MM-DD HH:mm:ss' instead of ISO" },
      { type: "fix", text: "Fixed Zuper searchJobs to correctly parse nested API response" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-02-01",
    title: "Command Center & PE Dashboard",
    description: "Unified command center and Participate Energy tracking dashboard.",
    changes: [
      { type: "feature", text: "Command Center - unified view of pipeline, scheduling, and alerts" },
      { type: "feature", text: "PE Dashboard - track Participate Energy projects and milestones" },
      { type: "feature", text: "Revenue tracking with forecast dates" },
      { type: "improvement", text: "Real-time data refresh every 5 minutes" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-01-28",
    title: "Master Scheduler & Crew Management",
    description: "Full-featured scheduling calendar with crew assignments and optimization.",
    changes: [
      { type: "feature", text: "Master Scheduler with month, week, and Gantt views" },
      { type: "feature", text: "Crew management with capacity tracking" },
      { type: "feature", text: "Auto-optimize feature for RTB projects" },
      { type: "feature", text: "CSV export for scheduled events" },
      { type: "improvement", text: "Drag-and-drop scheduling between dates and crews" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-01-20",
    title: "Initial Launch",
    description: "First release of PB Operations Suite with core dashboards.",
    changes: [
      { type: "feature", text: "Home page with dashboard navigation and favorites" },
      { type: "feature", text: "Department dashboards - Site Survey, Design, Permitting, Construction" },
      { type: "feature", text: "HubSpot integration for project data" },
      { type: "feature", text: "Authentication with email magic links" },
      { type: "internal", text: "Next.js 16 with Turbopack" },
    ],
  },
];

const TYPE_STYLES = {
  feature: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "New" },
  improvement: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Improved" },
  fix: { bg: "bg-orange-500/10", text: "text-orange-400", label: "Fixed" },
  internal: { bg: "bg-zinc-500/10", text: "text-muted", label: "Internal" },
};

export default function UpdatesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 hover:bg-surface-2 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Product Updates</h1>
              <p className="text-xs text-muted">Changelog & Release Notes</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/roadmap"
              className="flex items-center gap-2 text-xs text-muted hover:text-orange-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Roadmap
            </Link>
            <div className="text-xs text-muted">
              v{UPDATES[0].version}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8 p-4 bg-surface/50 border border-t-border rounded-xl">
          <p className="text-muted text-sm">
            Stay up to date with the latest features, improvements, and fixes to PB Operations Suite.
            We continuously improve based on your feedback.
          </p>
        </div>

        {/* Updates Timeline */}
        <div className="space-y-8">
          {UPDATES.map((update, index) => (
            <div key={update.version} className="relative">
              {/* Timeline line */}
              {index < UPDATES.length - 1 && (
                <div className="absolute left-[19px] top-12 bottom-0 w-px bg-surface-2" />
              )}

              {/* Update Card */}
              <div className="flex gap-4">
                {/* Version badge */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-xs font-bold shadow-lg shadow-orange-500/20">
                    {update.version.split(".")[0]}.{update.version.split(".")[1]}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="p-4 border-b border-t-border">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold">{update.title}</h2>
                          <p className="text-sm text-muted mt-1">{update.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-mono text-orange-400">v{update.version}</div>
                          <div className="text-xs text-muted/70 mt-0.5">{update.date}</div>
                        </div>
                      </div>
                    </div>

                    {/* Changes */}
                    <div className="p-4">
                      <ul className="space-y-2">
                        {update.changes.map((change, i) => {
                          const style = TYPE_STYLES[change.type];
                          return (
                            <li key={i} className="flex items-start gap-2">
                              <span
                                className={`text-[0.65rem] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 ${style.bg} ${style.text}`}
                              >
                                {style.label}
                              </span>
                              <span className="text-sm text-foreground/80">{change.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Roadmap CTA */}
        <div className="mt-12 p-6 bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">Want to shape what&apos;s next?</h3>
          <p className="text-muted text-sm mb-4">
            Vote on upcoming features and submit your own ideas on the Product Roadmap.
          </p>
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            View Roadmap & Vote
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted/70">
          <p>Have a specific bug report or urgent request?</p>
          <p className="mt-1">
            Contact:{" "}
            <a href="mailto:zach@photonbrothers.com" className="text-orange-400 hover:underline">
              zach@photonbrothers.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
