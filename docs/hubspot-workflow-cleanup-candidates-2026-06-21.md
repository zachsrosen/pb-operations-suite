# HubSpot Workflow Cleanup / Deletion Candidates

**Date:** 2026-06-21 · **Owner:** Zach (HubSpot automation)
**Source:** live Automation v4 API pull ([`data/hubspot-flows/all-flows.json`](../data/hubspot-flows/all-flows.json), 933 flows)

> Review-only. **Nothing was changed in HubSpot.** Every row is OFF or unnamed, so removing it cannot break a running automation. Deletion in HubSpot is permanent — if unsure, turn OFF + rename `(ARCHIVE)` instead of deleting. Columns: ID · object type (`0-3` deal / `0-5` ticket) · last updated · name.

---

## A. Autosave noise — `Unnamed workflow - <timestamp>` (17)
Abandoned editor autosaves. Unreferenced. **Delete.**

| ID | Obj | Updated | Name |
|---|---|---|---|
| `1652363912` | 0-3 | 2025-10-15 | Unnamed workflow - 2025-05-06 16:50:34 GMT+0000 |
| `1652864361` | 0-1 | 2025-10-15 | Unnamed workflow - 2025-05-08 18:39:15 GMT+0000 |
| `1661907225` | 0-3 | 2025-10-15 | Unnamed workflow - 2025-06-11 17:09:36 GMT+0000 |
| `1672495160` | 0-3 | 2025-10-15 | Unnamed workflow - 2025-07-16 14:52:26 GMT+0000 |
| `1700748823` | 0-3 | 2025-10-15 | Unnamed workflow - 2025-10-02 19:01:23 GMT+0000 |
| `1701256291` | 0-3 | 2025-10-15 | Unnamed workflow - 2025-10-03 23:43:35 GMT+0000 |
| `1719692969` | 0-5 | 2025-11-07 | Unnamed workflow - 2025-11-07 22:30:04 GMT+0000 |
| `1722507907` | 0-3 | 2025-11-12 | Unnamed workflow - 2025-11-12 17:47:18 GMT+0000 |
| `1722619818` | 0-3 | 2025-11-12 | Unnamed workflow - 2025-11-12 22:37:47 GMT+0000 |
| `1751169974` | 0-3 | 2025-12-29 | Unnamed workflow - 2025-12-29 17:27:22 GMT+0000 |
| `1761011067` | 0-3 | 2026-01-16 | Unnamed workflow - 2026-01-16 21:54:53 GMT+0000 |
| `1761116311` | 0-3 | 2026-01-16 | Unnamed workflow - 2026-01-16 22:13:36 GMT+0000 |
| `1770169891` | 0-53 | 2026-02-02 | Unnamed workflow - 2026-02-02 21:48:12 GMT+0000 |
| `1784342131` | 0-1 | 2026-02-28 | Unnamed workflow - 2026-02-28 23:28:50 GMT+0000 |
| `1802896564` | 0-3 | 2026-04-09 | Unnamed workflow - 2026-04-09 17:45:56 GMT+0000 |
| `1813886783` | 0-1 | 2026-04-30 | Unnamed workflow - 2026-04-30 16:48:34 GMT+0000 |
| `1838714452` | 0-1 | 2026-06-18 | Unnamed workflow - 2026-06-18 15:34:50 GMT+0000 |

---

## B. Explicitly retired — `(Turned Off)` prefix (3)
Already disabled and labeled as off. **Delete or archive.**

| ID | Obj | Updated | Name |
|---|---|---|---|
| `452278033` | 0-3 | 2025-07-20 | (Turned Off) Design Flow - Design Revision Ready For Stamping |
| `452276369` | 0-3 | 2025-07-20 | (Turned Off) Design Flow - Design Revision Returned From Designers |
| `1621174156` | 0-3 | 2025-07-03 | (Turned Off) Task to Order Placard for Inspection |

---

## C. Disabled clones — OFF `(cloned)` / `(#N)` copies (3)
Re-enrollment spares that were turned off. Confirm the live `(#N)` sibling carries the volume, then **delete.**

| ID | Obj | Updated | Name |
|---|---|---|---|
| `1676151203` | 0-3 | 2025-10-15 | 01e. Quality Flow - Review Needed (Survey Scheduling) (cloned) |
| `1651993640` | 0-3 | 2025-09-09 | Automated Project Thread Note (cloned) |
| `1838713645` | 0-1 | 2026-06-18 | June 2026 Hail Text - NON PB Customers (cloned) |

---

## D. Legacy-named & OFF — `- WMS` / `Lead -` superseded by the `NN. <Stage> Flow` family (6)
Old Westminster/lead-routing naming, disabled. The current numbered family replaced these. **Archive** (keep a note of which `NN.` flow replaced each).

| ID | Obj | Updated | Name |
|---|---|---|---|
| `1619463181` | 0-3 | 2025-12-20 | Design Lead - Design Approved - WMS |
| `1612729166` | 0-3 | 2025-10-07 | Precon Lead - Application Approved - WMS |
| `1678616604` | 0-3 | 2025-10-15 | Precon Lead - PTO Granted |
| `1613617710` | 0-3 | 2025-09-06 | Precon Lead - Permit Issued - WMS |
| `1678688558` | 0-3 | 2025-10-15 | Precon Lead - Xcel Photos Approved |
| `1691802513` | 0-3 | 2025-10-15 | Precon Lead - Xcel Photos Rejected |

---

## Summary
| Category | Count | Action |
|---|---|---|
| A · Autosave `Unnamed workflow` | 17 | Delete |
| B · `(Turned Off)` labeled | 3 | Delete/archive |
| C · OFF `(cloned)`/`(#N)` clones | 3 | Delete after sibling check |
| D · OFF legacy `WMS`/`Lead` names | 6 | Archive |
| **Distinct flows** | **29** | |

Out of 197 total OFF flows, these 29 are the high-confidence cruft. The remaining OFF flows are intentional kill-switched or seasonal automation — left off this list deliberately.
