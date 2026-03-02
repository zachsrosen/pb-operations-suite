# Email to Owners: PB Operations Suite Launch

---

**Subject:** Introducing the PB Operations Suite - Real-Time Pipeline Visibility

---

Hi Team,

I'm excited to share that we've launched the **PB Operations Suite** - a comprehensive dashboard system that gives you real-time visibility into our entire project pipeline. This connects directly to HubSpot and updates automatically every 5 minutes.

## What's Available

### For Leadership & Owners

**Executive Summary Dashboard**
- Total pipeline value and project counts at a glance
- Overdue project alerts with revenue at risk
- Location-by-location performance metrics
- Charts showing projects by stage and forecasted PTO timeline

**At-Risk Projects Dashboard**
- Prioritized list of projects needing attention
- Risk scores based on overdue milestones
- Filter by location and risk type
- Revenue impact calculations

**Location Comparison Dashboard**
- Side-by-side performance across all PB locations
- Track RTB backlog, PE projects, and pipeline value per location
- Click any location to drill into project details

### For Operations Teams

**Command Center**
- Real-time operations monitoring
- Crew capacity analysis by location
- Project urgency indicators
- One-click access to HubSpot records

**Master Scheduler**
- Visual calendar for installation scheduling
- RTB, Blocked, and Construction project queues
- Drag-and-drop scheduling (coming soon)
- Filter by location and crew

**PE Dashboard**
- All Participate Energy projects in one view
- Milestone tracking for PE-specific requirements
- Revenue and timeline forecasting

### For Field Teams (Mobile)

**Mobile Dashboard**
- Optimized for phones - add to your home screen
- Quick access to RTB, Overdue, PE, and Inspection projects
- Tap any project to open in HubSpot
- Location summaries at a glance

## How to Access

**Main URL:** https://pb-operations-suite.vercel.app

From there, you can navigate to any dashboard. The **Dashboard Hub** serves as the central navigation point.

**Password:** [Contact Zach for the password]

## Key Features

1. **Live Data** - All dashboards pull directly from HubSpot. Look for the green "Live Data" indicator.

2. **Auto-Refresh** - Data updates every 5 minutes automatically. No need to manually refresh.

3. **Direct Links** - Every project name links directly to its HubSpot record for quick access.

4. **Mobile Ready** - Works on phones and tablets. The mobile dashboard is specifically designed for on-the-go access.

## How Different Teams Will Use This

| Team | Primary Dashboards | Key Metrics |
|------|-------------------|-------------|
| **Owners** | Executive Summary, At-Risk | Pipeline value, overdue count, location health |
| **Operations Managers** | Command Center, Scheduler | Crew capacity, scheduling queue, blocked projects |
| **Location Managers** | Location Comparison, At-Risk | Their location's performance, projects needing attention |
| **PE Team** | PE Dashboard | PE milestone tracking, PE-specific pipeline |
| **Field Crews** | Mobile Dashboard, Scheduler | Today's projects, RTB queue |

## Coming Soon

- **Zuper Integration** - Two-way sync between scheduling and field service management
- **HubSpot Write-Back** - Update project dates directly from the scheduler
- **Email Alerts** - Daily/weekly summaries sent automatically
- **Custom Reports** - Export data for specific date ranges

## Questions or Feedback?

This system is designed to make your job easier. If you have questions, suggestions, or need a custom view for your team, please reach out to Zach.

Best,
Zach

---

## Quick Reference Card

| Dashboard | URL | Best For |
|-----------|-----|----------|
| Dashboard Hub | /dashboards/pb-dashboard-hub.html | Navigation to all dashboards |
| Executive Summary | /dashboards/pipeline-executive-summary.html | Leadership KPIs |
| At-Risk Projects | /dashboards/pipeline-at-risk.html | Problem projects |
| Command Center | /dashboards/pb-unified-command-center.html | Operations overview |
| Master Scheduler | /dashboards/pb-master-scheduler-v3.html | Scheduling |
| PE Dashboard | /dashboards/participate-energy-dashboard.html | PE tracking |
| Location Comparison | /dashboards/pipeline-locations.html | Regional analysis |
| Timeline | /dashboards/pipeline-timeline.html | Visual timeline |
| Mobile | /dashboards/pb-mobile-dashboard.html | Phone access |

---

## API Endpoints (For Developers)

```
GET /api/projects?stats=true          # All projects with stats
GET /api/projects?context=pe          # PE projects only
GET /api/projects?context=scheduling  # Scheduling queue
GET /api/projects?context=at-risk     # At-risk projects
GET /api/projects?context=executive   # Executive overview
```
