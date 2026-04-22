# Photon Brothers Tech Ops Suite - Complete User Guide

## Overview

This suite of dashboards and reports provides end-to-end visibility and control over your solar installation pipeline, from initial sale through PTO (Permission to Operate). The tools are designed to work together, each serving a specific purpose in your operations workflow.

---

## Tool Categories

### 1. STRATEGIC PLANNING (Leadership/Weekly Planning)
### 2. DAILY OPERATIONS (Operations Managers)
### 3. SCHEDULING & DISPATCH (Schedulers/Dispatchers)
### 4. FIELD OPERATIONS (Field Managers/Crews)
### 5. FINANCIAL TRACKING (Finance/PE Compliance)

---

## Detailed Tool Guide

---

## 1. STRATEGIC PLANNING TOOLS

### Dashboard Hub (`pb-dashboard-hub.html`)
**Who uses it:** Everyone
**When to use:** Starting point - navigate to any other dashboard

This is your central navigation portal. Open this first to access any other tool based on what you need to do.

---

### Pipeline Executive Summary (`pipeline-executive-summary.html`)
**Who uses it:** Leadership, Operations Directors
**When to use:** Weekly leadership meetings, board reviews, investor updates

**What it shows:**
- Total pipeline value ($20.34M)
- Projects by stage (visual funnel)
- Location performance comparison
- Month-over-month trends
- Key risk indicators

**How to use it:**
1. Open at the start of leadership meetings
2. Review the KPI cards at the top for quick health check
3. Click into location breakdowns to identify underperforming regions
4. Use the stage funnel to spot bottlenecks (e.g., 121 projects stuck in Inspection)

---

### Revenue Forecast (`revenue-forecast.xlsx`)
**Who uses it:** Finance, Leadership, Sales
**When to use:** Monthly forecasting, cash flow planning, sales target setting

**What it shows:**
- Expected revenue by month (probability-weighted)
- High/Medium/Low confidence buckets
- PE (Participate Energy) revenue separately tracked
- Location-by-location breakdown
- Stage conversion probabilities

**How to read it:**

| Confidence Level | What it Means | Conversion Rate |
|------------------|---------------|-----------------|
| High Confidence | Install Complete or later | 80-95% |
| Medium Confidence | RTB through Construction | 50-79% |
| Low Confidence | Permitting stages | 25-49% |

**Key insight:** The "Expected Revenue" column is your most reliable forecast - it's the sum of (deal value × conversion probability) for all projects.

---

## 2. DAILY OPERATIONS TOOLS

### Unified Command Center (`pb-unified-command-center.html`)
**Who uses it:** Operations Managers, Regional Managers
**When to use:** Daily morning standup, throughout the day for monitoring

**What it shows:**
- Real-time pipeline status across all locations
- PE milestone tracking with countdown timers
- Overdue projects flagged in red
- Quick action items requiring attention

**How to use it:**
1. **Morning routine:** Open first thing to see overnight changes
2. **Check the Alert Panel:** Red items need immediate attention
3. **PE Section:** Green checkmarks = on track, Red X = at risk
4. **Filter by location** to focus on your region

---

### Optimization Dashboard (`pb-optimization-dashboard.html`)
**Who uses it:** Operations Managers, Process Improvement
**When to use:** Identifying bottlenecks, process improvement initiatives

**What it shows:**
- **Bottleneck Detection:** Automatically identifies where projects get stuck
- **Priority Score Queue:** AI-calculated priority ranking for scheduling
- **Location Efficiency Scores:** Compare performance across branches
- **Stage Duration Analysis:** How long projects spend in each stage

**Understanding Priority Scores:**
The system calculates a score (0-1000+) based on:
- Days overdue (up to +100 per day overdue)
- PE status (+30-50 bonus for Participate Energy projects)
- Deal value (up to +30 for high-value deals)
- Stage urgency

**Higher score = Schedule this project first**

**Current Bottlenecks Identified:**
1. **Inspection Backlog:** 121 projects, $4.77M at risk
2. **PE Milestone Risk:** 38 projects, $1.52M PE revenue at risk

---

### Weekly Operations Report (`weekly-operations-report.xlsx`)
**Who uses it:** Operations Managers, Leadership
**When to use:** Weekly team meetings, performance reviews

**What it shows:**
- Week-over-week project movement
- Completion rates by location
- Crew productivity metrics
- Issues requiring escalation

---

### AHJ/Utility Tracker (`ahj-utility-tracker.xlsx`)
**Who uses it:** Permitting Team, Operations Managers
**When to use:** Identifying slow jurisdictions, planning permit submissions

**What it shows:**
- Performance scores for 83 AHJs (Authority Having Jurisdiction)
- Performance scores for 18 utilities
- Average permit processing times
- Overdue rates by jurisdiction
- Recommended actions for problem jurisdictions

**How to use it:**
1. **Before submitting permits:** Check the AHJ's score - low scores mean expect delays
2. **Escalation planning:** Focus on jurisdictions with scores < 50
3. **Staffing decisions:** High-volume slow AHJs may need dedicated resources

---

## 3. SCHEDULING & DISPATCH TOOLS

### Master Scheduler v3 (`pb-master-scheduler-v3.html`)
**Who uses it:** Schedulers, Dispatch Coordinators
**When to use:** Building weekly/monthly schedules, reassigning jobs

**What it shows:**
- Calendar view of all scheduled installs
- Drag-and-drop job assignment
- Crew capacity indicators
- Conflict detection

**How to use it:**
1. **Weekly planning session:**
   - Review RTB projects in the left panel
   - Check crew availability on the calendar
   - Drag projects to available slots
   - System warns if you exceed crew capacity

2. **Daily adjustments:**
   - Use filters to show only today's jobs
   - Drag to reschedule if needed
   - Click on a job to see details/contact info

---

### Comprehensive Schedule (`comprehensive-schedule.xlsx`)
**Who uses it:** Operations Managers, Schedulers
**When to use:** Monthly planning, resource allocation

**5 Sheets Explained:**

| Sheet | Purpose |
|-------|---------|
| **Summary** | High-level view of schedulable projects |
| **RTB Schedule** | 26 projects ready to schedule NOW |
| **Blocked-Action Req** | 48 projects that need unblocking first |
| **Pipeline-Coming Soon** | 31 projects in permitting with estimated RTB dates |
| **By Location** | Breakdown per branch |

**Workflow:**
1. Start with **RTB Schedule** - these are your immediate priorities
2. Review **Blocked-Action Req** - work to unblock these for next week
3. Check **Pipeline-Coming Soon** - these will be RTB in 1-4 weeks

---

### Next Month Schedule (`next-month-schedule.xlsx`)
**Who uses it:** Schedulers, Crew Leads
**When to use:** Monthly planning cycle (last week of month)

**What it shows:**
- Suggested schedule for next 4 weeks
- Crew assignments by location
- Capacity utilization percentages
- PE projects highlighted for prioritization

---

## 4. FIELD OPERATIONS TOOLS

### Mobile Dashboard (`pb-mobile-dashboard.html`)
**Who uses it:** Field Managers, Crew Leads (on phones/tablets)
**When to use:** On-site, in the field, quick reference

**Optimized for mobile devices with:**
- Large touch targets
- Quick-glance status cards
- Swipe navigation
- Offline-friendly design

**Features:**
- Today's jobs for your location
- One-tap to call customer
- One-tap to navigate to address
- Quick status update buttons

---

### Install Scheduler (`pb-install-scheduler-v2.html`)
**Who uses it:** Crew Leads, Field Dispatchers
**When to use:** Day-of scheduling, job sequencing

**What it shows:**
- Geographic view of day's installs
- Optimal route suggestions
- Time estimates between jobs
- Customer contact info

---

## 5. FINANCIAL & PE TRACKING TOOLS

### Participate Energy Dashboard (`participate-energy-dashboard.html`)
**Who uses it:** PE Compliance Manager, Operations
**When to use:** Daily PE tracking, milestone management

**Critical for PE Revenue!**

**What it tracks:**
- Projects enrolled in Participate Energy program
- Milestone deadlines (M1, M2, M3, M4)
- Days until/past each milestone
- Revenue at risk if milestones missed

**Milestone Overview:**
| Milestone | Typical Deadline | What's Required |
|-----------|------------------|-----------------|
| M1 | Contract signed + 30 days | Site survey complete |
| M2 | M1 + 45 days | Permit submitted |
| M3 | M2 + 60 days | Install complete |
| M4 | M3 + 30 days | PTO received |

**How to use it:**
1. **Daily:** Check projects going RED (past deadline)
2. **Weekly:** Review projects going YELLOW (within 14 days)
3. **Prioritize:** PE projects should jump the queue when at risk

---

### PE Submission Export (`pe-submission-export.xlsx`)
**Who uses it:** PE Compliance Manager
**When to use:** Weekly PE portal updates

**What it does:**
- Exports data in Participate Energy's required format
- Pre-fills all required fields
- Ready for direct upload to PE portal

**Workflow:**
1. Download this file weekly
2. Review for accuracy
3. Upload to Participate Energy portal
4. Track confirmation numbers

---

## Recommended Daily Workflows

### Operations Manager - Morning Routine (15 min)
1. Open **Unified Command Center** - scan for red alerts
2. Check **Optimization Dashboard** - review top 10 priority projects
3. Open **PE Dashboard** - check for milestone risks
4. Review any overnight updates in HubSpot

### Scheduler - Weekly Planning Session (1 hour)
1. Open **Comprehensive Schedule** - RTB tab
2. Cross-reference with **Master Scheduler v3** - check crew availability
3. Build next week's schedule using drag-drop
4. Export and share with crews

### Leadership - Weekly Review (30 min)
1. **Pipeline Executive Summary** - overall health
2. **Revenue Forecast** - financial projections
3. **Weekly Operations Report** - performance trends
4. **AHJ/Utility Tracker** - any new problem jurisdictions?

### Field Manager - Daily Routine
1. **Mobile Dashboard** - today's assignments
2. Check job details, customer info
3. Update status as jobs complete
4. Flag any issues for office follow-up

---

## Understanding the Data Flow

```
HubSpot CRM (Source of Truth)
        ↓
   Data Export/API
        ↓
┌───────────────────────────────────────┐
│         PROCESSING LAYER              │
│  • Forecast calculations              │
│  • Priority scoring                   │
│  • PE milestone tracking              │
│  • AHJ/Utility analysis               │
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│         OUTPUT TOOLS                  │
│  • HTML Dashboards (interactive)      │
│  • Excel Reports (shareable)          │
│  • JSON Data (for integrations)       │
└───────────────────────────────────────┘
```

---

## Key Metrics Definitions

| Metric | Definition | Target |
|--------|------------|--------|
| **Days to Install** | Days from Close Date to target install | < 45 days |
| **Days to PTO** | Days from Close Date to target PTO | < 90 days |
| **Priority Score** | Weighted urgency ranking (0-1000+) | Schedule highest first |
| **Conversion Rate** | Probability project reaches PTO | Varies by stage |
| **PE Compliance** | % of PE projects on track for milestones | > 90% |
| **AHJ Score** | Performance rating for jurisdiction | > 60 is good |

---

## Troubleshooting Common Questions

**Q: A project shows "Unknown" location - what do I do?**
A: Update the `pb_location` field in HubSpot. The dashboards pull this field to categorize projects.

**Q: Why is a project's priority score so high?**
A: Check: Is it overdue? Is it PE? Is it high value? All three factors increase score.

**Q: A PE project missed a milestone - now what?**
A: Contact PE program manager immediately. Some grace periods exist. Document the delay reason in HubSpot.

**Q: How often should I refresh the data?**
A: The Excel files are point-in-time snapshots. HTML dashboards should be regenerated weekly or when significant changes occur.

**Q: Can I edit the Excel files?**
A: Yes, but changes won't sync back to HubSpot. Use Excel for analysis and notes, but make official updates in HubSpot.

---

## Quick Reference: Which Tool When?

| I need to... | Use this tool |
|--------------|---------------|
| See overall pipeline health | Pipeline Executive Summary |
| Find what to schedule next | Optimization Dashboard |
| Build next week's schedule | Master Scheduler v3 |
| Check PE milestone status | Participate Energy Dashboard |
| See my location's projects | Unified Command Center (filtered) |
| Forecast next quarter's revenue | Revenue Forecast |
| Identify slow permit jurisdictions | AHJ/Utility Tracker |
| Quick reference in the field | Mobile Dashboard |
| Upload data to PE portal | PE Submission Export |
| Review crew workload | Comprehensive Schedule |

---

## File Locations

All files are saved in your Downloads folder:
- **HTML Dashboards:** Open in any web browser (Chrome recommended)
- **Excel Reports:** Open in Excel or Google Sheets
- **The Dashboard Hub** (`pb-dashboard-hub.html`) links to all other dashboards

---

*Guide generated January 2026 for Photon Brothers Operations*
