# HubSpot Task Schema Discovery

**Date:** 2026-03-01
**Purpose:** Document task properties, status values, and real task patterns for role-based skill automation.

---

## Task Properties

| Property | Label | Type | Description |
|----------|-------|------|-------------|
| `hs_task_subject` | Task Title | string | The title/name of the task |
| `hs_task_status` | Task Status | enum | NOT_STARTED, IN_PROGRESS, COMPLETED, WAITING, DEFERRED |
| `hs_task_type` | Task Type | enum | TODO, CALL, EMAIL, MEETING, LINKED_IN, LINKED_IN_CONNECT, LINKED_IN_MESSAGE |
| `hs_task_priority` | Priority | enum | NONE, LOW, MEDIUM, HIGH |
| `hs_task_body` | Task Notes | string (HTML) | Rich text content — includes instructions, links, revision reasons |
| `hs_timestamp` | Due date | datetime | When the task is due |
| `hubspot_owner_id` | Assigned to | string | HubSpot user assigned to the task |
| `hs_task_is_open` | Task is open | boolean | True if not completed |
| `hs_task_is_overdue` | Is Overdue | boolean | True if past due and not completed |
| `hs_task_completion_date` | Completed at | datetime | When the task was completed |
| `hs_task_blocked_task_ids` | Blocked by | string | Tasks blocking this one |
| `hs_task_blocking_task_ids` | Blocking | string | Tasks this one blocks |

All workflow-created tasks use `hs_task_type = "TODO"`.

---

## Real Task Patterns by Role

### Design Reviewer Tasks

| Subject Pattern | When Created | Body Contains | Skill Handler |
|----------------|-------------|---------------|---------------|
| `Complete Initial Design Review - {LOC}` | Design plans uploaded by vendor | Design Plans drive link, Project Type, AHJ, Utility, Sales Notes | Steps 1-3: Compliance + Equipment Match + Layout |
| `Complete Final Design Review For Stamping - {LOC}` | DA approved, ready for stamp | Design drive link, AHJ, Utility, Interconnection Status | Steps 1-2: Re-verify compliance + equipment match |
| `Send Plans For DA Revisions #{N} - {LOC}` | Designer identifies issues | Revision reason (free text) | Step 4: Revision Management |
| `Retrieve DA Revisions #{N} - {LOC}` | Vendor submits revised plans | DA Rejection Reason | Step 4: Re-review after revision |
| `Upload Approved DA Document - {LOC}` | DA signed by customer | Design Folder drive link | Step 5: Post-approval upload |
| `Upload Approved DA Document to Participate - {LOC}` | DA signed (Participate Energy projects) | Design Folder drive link | Step 5: Participate-specific upload |
| `Follow Up On DA Approval - {LOC}` | DA sent but no response (3+ days) | Follow-up instructions | N/A (manual follow-up) |
| `Upload Completed Design - {LOC}` | Site survey complete, vendor to design | Document Location, Lead Designer, PM | N/A (vendor task) |
| `Retrieve Plans for Stamping - {LOC}` | Design approved, needs PE stamp | Instructions to stamp and create letter | Engineering handoff |

### Sales / Ops Tasks

| Subject Pattern | When Created | Body Contains | Skill Handler |
|----------------|-------------|---------------|---------------|
| `Complete Contract and Deal Review - {LOC}` | Deal enters project pipeline | Detailed checklist: contract review, utility bill, proposal review, contacts | sales-advisor: Handoff Checklist |
| `Confirm if launched into Hatch` | New deal created | (empty) | sales-advisor: Qualify Lead |
| `Missing AHJ - {LOC}` | AHJ field empty on deal | Instructions to populate AHJ | sales-advisor: Handoff Checklist |

### Engineering / Permitting Tasks

| Subject Pattern | When Created | Body Contains | Skill Handler |
|----------------|-------------|---------------|---------------|
| `Submit Permit To AHJ - {LOC}` | Design complete, ready for permit | Design link, AHJ, Submission Method, Portal Link, Login/Password | engineering-reviewer: Permit Package Prep |
| `Submit Interconnection Application To The Utility - {LOC}` | Design complete | Sales/Design docs links, Utility, Submission Type, Portal Link, Login | engineering-reviewer: Permit Package Prep |
| `Submit As-Built Revision #{N} to AHJ - {LOC}` | Post-inspection corrections needed | Design link, AHJ, Revision Reason, Portal Link, Login | N/A (post-construction) |
| `Submit As-Built Revision to the Utility - {LOC}` | Post-inspection utility update | Design link, Utility, Revision Reason | N/A (post-construction) |
| `Follow Up On Supplemental Review - {LOC}` | Interconnection in supplemental review | Follow-up instructions | N/A (manual follow-up) |
| `Upload Site Survey Information - {LOC}` | Site survey completed | Survey date, upload instructions | N/A (surveyor task) |

### Other Tasks

| Subject Pattern | When Created | Body Contains |
|----------------|-------------|---------------|
| `Follow up with customer regarding rebate check and Texture Opt-Out` | Rebate timeline | Customer follow-up instructions |
| `Onboard Project To Participate Energy - {LOC}` | Participate contract signed | Onboarding instructions |
| `Invoice Past Due - {N} Days` | Invoice overdue | Collection instructions |

---

## Suffix Convention

Task subjects end with a location suffix:
- `- ZRS` — appears on most tasks (likely default/main)
- `- WMS` — Westminster location tasks

These suffixes appear to be auto-appended by workflows based on the deal's `pb_location` or warehouse.

---

## Task Body Patterns

Task bodies are **HTML formatted** and contain structured data:

**Design tasks include:**
- `Design Plans:` or `Design Folder:` or `Design:` — Google Drive folder URL
- `Project Type:` — Solar, Battery, etc.
- `AHJ:` — jurisdiction name
- `Utility:` — utility company name
- `Sales Notes:` — free text from salesperson
- `Interconnection Status:` — current status
- `DA Rejection Reason:` — why DA was rejected (revision tasks)
- `As-Built Revision Reason:` — what needs to change

**Permitting tasks include:**
- `Submission Method:` — Portal, Email, etc.
- `Link to Application:` — AHJ/utility portal URL
- `Login:` / `Password:` — portal credentials
- `Resubmission Required?` — yes/no

---

## Key Insights for Skill Implementation

1. **Tasks are workflow-generated** — subjects follow consistent patterns with `{LOC}` suffix
2. **Task bodies are rich** — contain drive links, AHJ/utility names, revision reasons, portal credentials
3. **Revision tracking is built into task names** — `#1`, `#2`, etc. indicate revision round
4. **The design-reviewer skill should parse task bodies** — extract Drive links, AHJ, utility from the HTML body rather than making separate API calls (the data is already there)
5. **2,506 open NOT_STARTED tasks** exist — skills will need to filter by deal association
6. **Total task volume is high** — 16,190 tasks match "design" search, 9,590 match "revision"
7. **Tasks contain sensitive data** — portal logins/passwords appear in task bodies (skills should never expose these)
