# Pre-Sale Survey Scheduling Design

**Date:** 2026-02-24
**Status:** Approved

## Overview

Add a toggle to the existing site-survey-scheduler page that switches between "Ops Surveys" (current behavior) and "Pre-Sale Surveys". In pre-sale mode, the sidebar project list is replaced with a search box that queries Sales Pipeline deals by name/address. Once a deal is selected, the same scheduling flow applies — pick a date, pick a surveyor, see available slots, confirm.

## Requirements

- Salespeople can search for their Sales Pipeline deals by homeowner name or address
- Uses the same surveyor availability slot system as ops surveys
- On confirm: create a Zuper job, update HubSpot `site_survey_schedule_date`, write DB record, send email + calendar invite
- No new database schema changes needed

## Key Changes

### 1. New API Route: `GET /api/deals/search`

Search the Sales Pipeline (`default`) by deal name or address.

**Query params:**
- `q` — search string (name or address)
- `pipeline` — defaults to `sales`

**Returns:** Array of `{ id, name, address, city, state, location, amount, stage, ownerName }`

**Implementation:** Use HubSpot Search API against the `default` pipeline. Fetch the additional properties needed for scheduling that the current `/api/deals` route doesn't include: `address_line_1`, `city`, `state`, `pb_location`.

### 2. Site Survey Scheduler UI Changes

**Toggle:** Add "Ops Surveys" | "Pre-Sale" tab/toggle at top of sidebar.

**Pre-sale mode sidebar:**
- Search input replaces the auto-loaded project list
- Debounced search (300ms) hits `/api/deals/search?q=...`
- Results display as selectable cards showing: name, address, location, amount, stage
- Visual badge/tag indicating "Pre-Sale" on selected deal

**Calendar/scheduling flow:** Identical to current ops flow once a deal is selected:
- Click a date on calendar
- Schedule modal opens with surveyor dropdown
- Slot availability system loads
- Confirm schedules the survey

### 3. Schedule API Adjustment

**`PUT /api/zuper/jobs/schedule`:**
- Pass `rescheduleOnly: false` for pre-sale surveys (no existing Zuper job to reschedule — must create fresh)
- Accept a `surveyType: "pre-sale"` flag to distinguish from ops surveys

**`ScheduleRecord`:**
- `scheduleType: "pre-sale-survey"` to distinguish from `"survey"`

**HubSpot write-back:**
- Update `site_survey_schedule_date` on the Sales Pipeline deal (property exists globally across pipelines)

### 4. Data Model

No schema changes needed:
- `ScheduleRecord.scheduleType` is a free string — `"pre-sale-survey"` works immediately
- `ZuperJobCache` keys by `hubspotDealId` — works for Sales Pipeline deals

### 5. What Stays the Same

- Surveyor availability slot system (unchanged)
- Zuper job creation logic (`createJobFromProject`)
- Email notifications + Google Calendar invites
- HubSpot property write-back mechanism
- All existing ops survey functionality
- Permission model (SALES role already has `canScheduleSurveys: true`)
