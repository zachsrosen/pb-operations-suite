# PB Operations Suite - Roadmap

## High Priority

### 1. Performance - Make Loading Faster
- [ ] Implement data caching (Redis or in-memory)
- [ ] Add pagination to API endpoints
- [ ] Optimize HubSpot API calls (batch requests, reduce payload)
- [ ] Add loading skeletons for better perceived performance
- [ ] Consider server-side rendering for initial data
- [ ] Implement incremental static regeneration where applicable

### 2. User Access Levels & Control
- [ ] Define role hierarchy (Admin, Manager, Viewer, etc.)
- [ ] Add role field to user accounts
- [ ] Implement permission-based route protection
- [ ] Add UI controls based on user role (hide/show features)
- [ ] Create admin panel for user management
- [ ] Add audit logging for sensitive actions

### 3. Zuper Job Links in Scheduler Tools
- [ ] Store Zuper job UID when creating/syncing jobs
- [ ] Add Zuper link alongside HubSpot link in:
  - [ ] Site Survey Scheduler project cards
  - [ ] Master Scheduler project cards
  - [ ] Schedule confirmation modals
  - [ ] Project detail modals
- [ ] Add Zuper icon/badge for projects synced to Zuper

---

## Medium Priority

### Data & Integrations
- [ ] Two-way sync with Zuper (pull job status updates)
- [ ] Webhook support for real-time HubSpot updates
- [ ] Export scheduled events to Google Calendar
- [ ] Email notifications for schedule changes

### UI/UX Improvements
- [ ] Dark/light theme toggle
- [ ] Mobile-responsive scheduler views
- [ ] Keyboard shortcuts for common actions
- [ ] Bulk scheduling operations

### Analytics & Reporting
- [ ] Historical performance trends
- [ ] Crew utilization reports
- [ ] Revenue forecasting dashboard
- [ ] Custom report builder

---

## Low Priority / Future Ideas

- [ ] AI-powered schedule optimization suggestions
- [ ] Customer portal for appointment booking
- [ ] Integration with accounting software
- [ ] Field technician mobile app
- [ ] SMS notifications to customers

---

## Completed

- [x] Multi-select location filters on schedulers
- [x] Availability overlay on Site Survey Scheduler
- [x] Zuper FSM integration (create/schedule jobs)
- [x] Site Survey Scheduler with Zuper sync
- [x] Master Scheduler with crew management
- [x] Command Center unified dashboard
- [x] PE Dashboard for Participate Energy tracking
