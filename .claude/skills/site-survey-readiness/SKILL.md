---
name: site-survey-readiness
description: Check site survey folder completeness before IDR (Initial Design Review) meetings. Use when the user asks to "check site survey readiness", "IDR prep for PROJ-XXXX", "is the site survey complete for this project", "review site survey photos", "what's missing from the site survey", "IDR checklist", "check SS folder", or wants to verify that a project's site survey deliverables are present and complete before the design team reviews it. Also use when the user mentions preparing for an IDR meeting, checking survey completeness, or reviewing survey documentation for any project.
---

# Site Survey Readiness Checker

Verify that a project's site survey folder has everything the design team needs before the IDR (Initial Design Review) meeting. This is especially valuable when the site surveyor can't attend the meeting — the report stands in for them.

## What This Skill Checks

| # | Check | Severity | Description |
|---|-------|----------|-------------|
| 1 | **Install location photos** | error | Photos showing where equipment will be installed (roof, ground mount area, exterior/interior walls) |
| 2 | **Existing equipment photos** | error | Photos of main service panel, utility meter, breakers, conductor sizes, electrical panels |
| 3 | **Equipment specs** | warning | Existing solar equipment details if this is an add-on/replacement project |
| 4 | **Solarviews** | error | Photo mockup showing proposed equipment placed on the actual site photo. This is NOT the same as an overhead site plan — solarviews are specifically labeled mockup images. |
| 5 | **DA draft** | warning | Design Approval document started in PandaDoc (checked via HubSpot integration) |
| 6 | **CWB photos** | warning | Cold Water Bond photos — needed for grounding verification |
| 7 | **Attic photos** | conditional | Required for PV (solar) projects — interior location photos showing rafter spacing, sheathing, obstructions. Not required for battery-only. |

**Severity guide:**
- `error` = missing and required — blocks IDR readiness
- `warning` = should be present but IDR can proceed without it
- `info` = optional or FYI

---

## Workflow

### 1. Identify the Project

Get the deal from the user — they'll provide a PROJ number, customer name, or HubSpot deal ID.

Look up the deal in HubSpot:

```
mcp__98214750__search_crm_objects
  objectType: deals
  query: "PROJ-1234" (or customer name)
  properties: [
    "dealname",
    "project_type",
    "all_document_parent_folder_id",
    "design_documents",
    "site_survey_documents",
    "site_survey_status",
    "is_site_survey_completed_",
    "site_surveyor",
    "site_survey_date",
    "module_brand",
    "module_count",
    "inverter_brand",
    "battery_brand",
    "battery_count",
    "calculated_system_size__kwdc_",
    "dealstage"
  ]
```

If the deal's `is_site_survey_completed_` is not true or `site_survey_status` doesn't indicate completion, note this as an info finding — the survey may still be in progress.

### 2. Scan the Site Survey Folder

Use the bundled script to list all files in the site survey folder recursively:

```bash
npx tsx .claude/skills/site-survey-readiness/scripts/list-drive-files.ts "<site_survey_documents URL or folder ID>"
```

The script outputs JSON: `[{ name, mimeType, modifiedTime, size, parentFolder }, ...]`

**Folder source priority:**
1. `site_survey_documents` property — direct link to the survey folder (preferred)
2. `all_document_parent_folder_id` — root project folder; navigate to "1. Site Survey" subfolder

If `site_survey_documents` is empty, use the Google Drive MCP to find the "Site Survey" subfolder under the root folder, then pass that folder ID to the script.

### 3. Identify the Survey System

Surveys come from different systems with different file naming conventions. Identify which system was used before categorizing:

**System A — Descriptive names (current survey form):**
Files have structured names like `Roof_Photos0`, `Additional_Electrical_Panels3`, `Circuit_Run_Photos1`. A trailing number is the photo index within that category. Easy to categorize automatically.

**System B — 3422 survey app (UUID filenames):**
Photos are UUID-named (e.g., `c86e4244-46f6-4407-a087-bad429ef8ff2.jpg`). A large comprehensive PDF report (~8-10 MB, named like `site_survey_-_colorado_*.pdf` or `Site Survey - Colorado Report`) contains all photos with labels. Solarviews are separately named: `SolarView (Customer Name).jpeg`.

**System C — Manual upload (generic camera filenames):**
Photos have camera-generated names like `LM001`, `DC001`, `DJI_0042`. No structured naming. May include separate walk/drone photo sets from different dates.

**How to detect:**
- If most files match `[Category_Name][0-9]+` → System A
- If most files are UUID patterns (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg`) → System B
- If files are short alphanumeric codes or camera names → System C

### 4. Categorize Files Against the Checklist

#### System A (descriptive names) — match against these patterns:

| Category | File name patterns (case-insensitive) |
|----------|--------------------------------------|
| **Install location** | `Roof_Photos`, `360_Degree_Photos_of_Site`, `All_Possible_Exterior_Location_Photos`, `ground_mount`, `array_area`, `DJI` (drone roof shots) |
| **Existing equipment** | `Photos_of_Main_Service_Panel`, `Utility_Meter`, `meter_height`, `MSD`, `dead_front`, `breakers_labels`, `conductor_sizes`, `Additional_Electrical_Panels`, `Voltage_Readings`, `Circuit_Run_Photos` |
| **Solarviews** | `SolarView`, `solarview`, `solar_view` — these are specifically labeled mockup photos showing proposed equipment on the site. Do NOT count `Upload_Overhead_Photo_With_Equipment_Locations_Site_Plan` as a solarview — that is a site plan/overhead, not a mockup. |
| **CWB** | `Cold_Water_Bond`, `cwb`, `water_bond` |
| **Attic / interior** | `All_Possible_Interior_Location_Photos`, `attic`, `rafter`, `truss`, `sheathing`, `roof_structure` |
| **ESS (battery)** | `ESS_photos`, `battery_location`, `energy_storage` |
| **Site plan** | `Upload_Overhead_Photo_With_Equipment_Locations_Site_Plan`, `site_plan`, `overhead` (useful but NOT a solarview) |
| **Survey PDF** | `site_survey_*.pdf` (the completed survey form) |
| **JHA** | `jha_form*.pdf` (Job Hazard Analysis) |

#### System B (UUID/3422 app) — use heuristics:

Individual photo categorization is not possible from filenames. Instead:
- **Check for the report PDF** — a large PDF (~8-10 MB) contains all labeled photos. If present, assume install location and existing equipment photos are covered.
- **Check for `SolarView (Name).jpeg`** — solarviews are separately named even in this system.
- **Photo count** — a thorough survey typically has 30-70 photos. Fewer than 20 is worth noting.
- **Mark CWB and attic as `UNABLE TO VERIFY`** — cannot confirm specific categories from UUIDs. Note that the report PDF likely contains them but manual review is needed.

#### System C (generic camera names) — use heuristics:

Similar to System B — cannot categorize by filename. Check:
- Total photo count and presence of multiple upload dates (suggests thorough coverage)
- Look for any descriptively named files mixed in
- Check for drone photos (DJI prefix) — indicates roof coverage
- Mark specific categories as `UNABLE TO VERIFY` unless descriptive files are found

### 5. Check DA Draft Status

Look for PandaDoc integration data on the HubSpot deal. PandaDoc documents appear as associated engagements or in deal properties through the HubSpot-PandaDoc integration.

If you can't determine DA status from HubSpot, mark it as `unable_to_verify` rather than failing — suggest the user check PandaDoc directly.

### 6. Determine Conditional Requirements

**Attic / interior photos** are required only for PV projects:
- Check `project_type` property
- If the project includes "Solar" → attic/interior photos are required (`error` if missing)
- If "Battery" only → not required (`info` — note as N/A)

**Existing equipment specs** are relevant only for add-on/replacement projects:
- If there's existing solar equipment in deal properties, check for documentation

### 7. Produce the Report

```
## Site Survey Readiness — PROJ-XXXX (Customer Name)

**Surveyor:** Jane Smith
**Survey Date:** 2026-03-27
**Project Type:** Battery + Solar (5.28 kW)
**Survey Status:** Completed
**Survey System:** Descriptive names (current form)

### Checklist

| # | Item                    | Status | Count | Files |
|---|-------------------------|--------|-------|-------|
| 1 | Install location photos | ✅ PASS | 5     | Roof_Photos (1), 360_Degree_Photos_of_Site (4) |
| 2 | Existing equipment      | ✅ PASS | 17    | Main_Service_Panel (1), MSD photos (6), Electrical_Panels (9), Voltage_Readings (2) |
| 3 | Equipment specs         | ⬜ N/A  | —     | New install, no existing solar |
| 4 | Solarviews              | ❌ MISSING | 0   | No solarview mockup photos found |
| 5 | DA draft                | ❓ UNABLE TO VERIFY | — | Check PandaDoc directly |
| 6 | CWB photos              | ⚠️ NOT FOUND | 0 | No Cold Water Bond photos in folder |
| 7 | Attic photos            | ✅ PASS | 1     | All_Possible_Interior_Location_Photos (1) |

### Summary

**Ready for IDR: NO** — 1 required item missing

**Action items:**
1. ❌ Solarviews need to be created before IDR — photo mockup of equipment on site
2. ⚠️ No CWB photos — verify grounding documentation exists elsewhere
3. ❓ DA draft status not verified — check PandaDoc

### All Files (30 total)
| File | Type | Folder | Modified |
|------|------|--------|----------|
| 360_Degree_Photos_of_Site0 | image/jpeg | Site Survey - Colorado | 2026-03-27 |
| ... | ... | ... | ... |
```

**Status symbols:**
- ✅ PASS — present and accounted for
- ❌ MISSING — required but not found (blocks IDR)
- ⚠️ NOT FOUND — recommended but not blocking
- ⬜ N/A — not applicable for this project type
- ❓ UNABLE TO VERIFY — couldn't determine status

**Ready for IDR** = all `error`-severity checks pass. Warnings don't block readiness.

---

## Batch Mode

If the user asks to check multiple projects (e.g., "check readiness for all surveys completed this week"), search HubSpot with a date filter:

```
filterGroups: [{ filters: [
  { propertyName: "site_survey_date", operator: "GTE", value: "2026-03-24" },
  { propertyName: "site_survey_date", operator: "LTE", value: "2026-03-28" }
]}]
```

Run the check for each project and produce a summary table:

```
## IDR Readiness Summary — Week of 2026-03-24

| Project | Customer | Type | Surveyor | Ready? | Missing Items |
|---------|----------|------|----------|--------|---------------|
| PROJ-9612 | Pieren | Solar+Battery | Caleb R. | ❌ No | Solarviews |
| PROJ-9598 | Love | Solar+Battery | Caleb R. | ❌ No | Solarviews |
| PROJ-9542 | Brownell | Battery | Patrick H. | ✅ Yes | — |
```

Then offer to show the detailed report for any project.

---

## Tips

- **Solarviews are NOT site plans** — `Upload_Overhead_Photo_With_Equipment_Locations_Site_Plan` is a site plan/overhead photo. Solarviews are specifically labeled mockup images showing proposed equipment on the actual site photo (e.g., `SolarView (Customer Name).jpeg`). These are different things.
- **Three survey systems** — newer surveys use descriptive names (easy to categorize), older 3422 surveys use UUID filenames (need the report PDF), and some use generic camera names. Detect which system first, then adjust your approach.
- **CWB is often missing** — Cold Water Bond photos are frequently absent. Flag it but don't block IDR.
- **Subfolder structure** — files are typically under a `Site Survey - {State}` subfolder, sometimes with a `JHA Form` sibling folder. Always scan recursively.
- **DA drafts** — PandaDoc integration data in HubSpot can be unreliable. When in doubt, mark as "unable to verify" and recommend checking PandaDoc directly.
- **Multiple surveys** — if a project has been re-surveyed, the `site_survey_date` on the deal reflects the most recent. Check file dates if uncertain.
- **Photo count heuristic** — a thorough survey typically has 30-70 photos. Fewer than 20 is worth noting as potentially incomplete.
