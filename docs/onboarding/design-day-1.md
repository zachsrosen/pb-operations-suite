# Welcome to Photon Brothers — Design Team

A short orientation to get you productive on Day 1. Everything below is verified against the live system as of 2026-04-27.

---

## Your account & access

You'll be set up with the **`DESIGN`** role, which gates you to the **Design & Engineering Suite**. You'll have read access to AHJ and Utility design requirements (so you can look up jurisdiction-specific rules) but you won't manage the trackers or the permitting/interconnection action queues — those are owned by the Permitting and Interconnection teams.

What that means in practice:

| Action | Yes / No |
|---|---|
| View Design & Engineering Suite | ✅ |
| Edit designs in HubSpot | ✅ |
| View AHJ Requirements (read-only) | ✅ |
| View Utility Design Requirements (read-only) | ✅ |
| Edit Permitting | — |
| Schedule Surveys / Installs / Inspections | — |
| Sync to Zuper | — |
| View All Locations | Own location only |

If you need access beyond Design (e.g. seeing other locations), ask Zach.

---

## First things to bookmark

These are the dashboards you'll live in. Suite landing page first; everything else is one click from there.

**Suite landing:** [Design & Engineering Suite](https://ops.photonbrothers.com/suites/design-engineering)

**Daily / weekly dashboards:**
- [D&E Overview](https://ops.photonbrothers.com/dashboards/de-overview) — current design workload, what's open, who owns it
- [Plan Review](https://ops.photonbrothers.com/dashboards/plan-review) — designs awaiting internal QC before going to the customer
- [Pending Approval](https://ops.photonbrothers.com/dashboards/pending-approval) — DA sent, waiting on customer signature; chase stale ones
- [Design Revisions](https://ops.photonbrothers.com/dashboards/design-revisions) — active revision cycles (DA, permit, IC, as-built)
- [D&E Metrics](https://ops.photonbrothers.com/dashboards/de-metrics) — turnaround times and throughput
- [IDR Meeting](https://ops.photonbrothers.com/dashboards/idr-meeting) — Initial Design Review board

**Reference (read-only):**
- [AHJ Requirements](https://ops.photonbrothers.com/dashboards/ahj-requirements) — jurisdiction-specific stamping, code year, snow load, submission method
- [Utility Design Requirements](https://ops.photonbrothers.com/dashboards/utility-design-requirements) — per-utility system size rules, AC disconnect, production meter, etc.

**Tools:**
- [Solar Surveyor / Solar Designer](https://ops.photonbrothers.com/dashboards/solar-surveyor) — site survey + design tooling
- [Plan Review queue](https://ops.photonbrothers.com/dashboards/plan-review)
- [Product Catalog](https://ops.photonbrothers.com/dashboards/product-catalog) / [Submit Product](https://ops.photonbrothers.com/dashboards/submit-product) / [Request Product](https://ops.photonbrothers.com/dashboards/request-product) — equipment specs and new-product flow
- [BOM](https://ops.photonbrothers.com/dashboards/bom) — bill of materials per project
- [TSRF Calculator](https://ops.photonbrothers.com/dashboards/tsrf-calculator) — shading calc
- [Adders](https://ops.photonbrothers.com/dashboards/adders) — pricing adders

**Day-to-day team tools:**
- [My Tasks](https://ops.photonbrothers.com/dashboards/my-tasks) — your HubSpot task queue
- [My Tickets](https://ops.photonbrothers.com/dashboards/my-tickets) — Freshservice IT tickets you've opened
- [Comms](https://ops.photonbrothers.com/dashboards/comms)
- [On-Call](https://ops.photonbrothers.com/dashboards/on-call) — current on-call rotation

> Replace `ops.photonbrothers.com` with whatever URL Zach gives you for the prod app.

---

## Read these SOPs first (in this order)

The internal SOP guide lives at **`/sop`** in the ops app. Tabs are role-gated — your Design role gives you access to the public tabs and the Design tab.

### Day 1 reading

1. **HubSpot Guide → Reading a Deal Record** — every solar project lives in HubSpot. This SOP shows you the deal-record layout: left sidebar (property groups), center panel (activity feed, tabs), right sidebar (linked records, AHJs, utilities, line items). Spend 20 minutes here before anything else.
2. **Project Pipeline → Pipeline Overview** — the 9-stage flow from Site Survey → Design & Engineering → Permitting & IC → RTB → Construction → Inspection → PTO → Close Out → Project Complete. Know which stages you own (D&E) and which you're handing off to.
3. **Design tab → Role Overview** — your access list and capabilities (the same ones in the table above, just inside the app).
4. **Design tab → Design Workflow** — the design lifecycle in HubSpot, every date that gets stamped, every revision counter. This is the one to actually internalize.
5. **Design tab → Plan Review** — the internal QC checklist before a design goes to the customer for approval.
6. **Design tab → Your Tools** — daily-flow cheat sheet (morning queue check → midday design work → afternoon plan review → end-of-day HubSpot date updates).

### Day 2–3

7. **Project Pipeline → Site Survey** — what happens before a project hits your queue, so you know what to expect in the survey docs.
8. **Project Pipeline → Design Approval (DA)** — the customer-facing DA process and how PandaDoc fits in.
9. **Project Pipeline → Design & Engineering** — the canonical pipeline-stage description (versus the role-overview above).
10. **Reference → HubSpot Status Fields → Design Status / Design Approval Status** — the full enum of statuses you'll see on a deal.
11. **Reference → Workflow Reference → Design & Engineering / DA Revision** — what HubSpot automations fire during your stage.

### Reference (skim, don't memorize)

- **Reference → HubSpot Status Fields → Permitting Status / Interconnection Status** — useful so you know what state a project is in when you hand it off (or get a question about it).
- **Reference → Pipeline Stages → Project Pipeline** — definitive stage map.
- **Project Pipeline → Permitting / Interconnection / RTB Gate** — what happens after your hand-off.

---

## Workflow basics

A project moves through Design like this:

1. **Project enters D&E stage in HubSpot.** `Design Start Date` gets stamped. The project shows up in your D&E Overview.
2. **You produce a design draft.** When the first draft is back, stamp `Date Returned From Designers` and `Design Draft Completion Date`.
3. **Internal plan review.** Use the [Plan Review](https://ops.photonbrothers.com/dashboards/plan-review) dashboard. Checklist: module count and layout, inverter/battery sizing, AHJ requirements, utility design requirements, structural calcs, electrical SLD.
4. **Send DA to customer (via PandaDoc).** Stamp `Design Approval Sent Date`. Project shows in Pending Approval until the customer signs.
5. **Customer approves.** Stamp `Design Completion Date`. If a PE stamp is required (per the AHJ), submit for engineering, then stamp `Engineering Submission Date` and `Engineering Stamped Date`.
6. **If customer rejects:** read "Design Approval Notes from Customer" and "DA Rejection Reason", spin a revision, increment `DA Revision Counter`.

Four revision counters live on the deal record (DA, Permit, Interconnection, As-Built); only DA revisions are yours to drive directly. Permit and IC revisions get triaged by their teams but may bounce back to you for plan changes.

---

## How HubSpot fits in (quick orientation)

- The **deal record** is the source of truth. Three regions: left (property groups), center (tabs, activity feed), right (cards — Contacts, Line Items, AHJs, Utilities, etc.).
- The **AHJ & Utility tab** on the deal record shows the project's specific AHJ + utility rules (stamping required, snow/wind load, system size rule, AC disconnect rule, etc.). Read this before you cut a design.
- HubSpot has **70+ workflows** firing during the D&E stage. Most of them stamp dates or move tasks; you don't trigger them manually. The Reference tab lists them if you ever need to know what's happening behind the scenes.
- We do **not** use Slack. Internal comms are **Google Chat, email, SMS, or HubSpot tasks**. If you get a task assigned in HubSpot, that's a real to-do item — it shows up on your [My Tasks](https://ops.photonbrothers.com/dashboards/my-tasks) dashboard.

---

## Who to ask

| Question | Person |
|---|---|
| Login / role / can't access something | Zach |
| HubSpot deal-record questions | Zach or your direct manager |
| Why a workflow fired / didn't fire | Zach |
| AHJ-specific design rules | Permitting team |
| Utility-specific design rules | Interconnection team |
| Equipment sizing / catalog questions | Tech Ops / your direct manager |

Bug or broken page in the ops app: hit the Bug Report button (top-right in the app), or open a Freshservice ticket.

---

## What to expect Week 1

- Day 1: read the SOPs above, get logged into HubSpot and the ops app, watch your manager walk through one live design.
- Day 2: shadow a plan review.
- Days 3–5: pick up your first design under supervision; submit it through Plan Review.
- End of Week 1: start carrying a small queue independently.

Welcome aboard.
