# Setup: Push PowerHub device serials to HubSpot + Zuper

**Author:** Claude + Zach
**Date:** 2026-05-20
**Status:** Code shipped (PR #TBD). HubSpot + Zuper admin setup pending.

## What ships in this PR

Code that knows how to push per-device serial numbers + a formatted hardware summary from `HubSpotPropertyCache` to:

**HubSpot** (5 new custom properties × 3 objects)
- Property object
- Deal object
- Ticket object

**Zuper** (5 new custom fields × 2 modules)
- Property module
- Job module (cascaded from Property)

Until the HubSpot properties + Zuper fields exist on the platform side, the writes are silent no-ops (HubSpot rejects unknown properties cleanly, Zuper ignores unknown custom field labels). So this PR is safe to ship + merge before the admin setup is done.

## What you (the admin) need to do

### Step 1 — HubSpot: create 5 properties on each of 3 objects

For each of: **Property** (custom object), **Deal**, **Ticket**, create these 5 properties under the existing **Tesla PowerHub** property group:

| Internal name | Label | Field type | Notes |
|---|---|---|---|
| `tesla_gateway_serial` | Tesla Gateway Serial | Single-line text | Primary device identifier |
| `tesla_powerwall_serials` | Tesla Powerwall Serial(s) | Single-line text | Semicolon-joined for multi-PW |
| `tesla_inverter_serial` | Tesla Inverter Serial | Single-line text | |
| `tesla_meter_serial` | Tesla Meter Serial | Single-line text | |
| `tesla_hardware_summary` | Tesla Hardware Summary | Multi-line text | Formatted block for copy-paste |

Total: 15 properties (5 × 3 objects).

How to create them in HubSpot UI:
1. Settings → Properties → Select object (Property / Deal / Ticket)
2. Filter to the existing **Tesla PowerHub** group
3. Click **Create property** → fill in the table above
4. Repeat for each object

### Step 2 — Zuper: create 5 custom fields on each of 2 modules

For each of **Property** and **Job**, create these 5 custom fields:

| Label | Field type |
|---|---|
| Tesla Gateway Serial | Single Line Text |
| Tesla Powerwall Serials | Single Line Text |
| Tesla Inverter Serial | Single Line Text |
| Tesla Meter Serial | Single Line Text |
| Tesla Hardware Summary | Multi Line Text |

Total: 10 fields (5 × 2 modules).

How to create them in Zuper UI:
1. Settings → Custom Fields → Select module (Property / Job)
2. Click **Add Field** → fill in the table above
3. Repeat for each module

### Step 3 — Trigger a property re-sync

After Step 1 + 2 are complete, run a one-shot push for all 2,603 PowerHub-linked properties:

```bash
cd PB-Operations-Suite
set -a && source .env && set +a
npx tsx scripts/resolve-powerhub-primaries.ts  # populates new denorm columns
# Then trigger cross-system push for each property:
npx tsx scripts/backfill-powerhub-device-push.ts  # to be written
```

The first script (already exists from the geo-linking PR) recomputes `resolvePrimarySite()` for every property, which populates the new `teslaGatewaySerial` / `teslaPowerwallSerials` / etc. columns from each primary site's devices JSON.

The second script (to be written before this runbook is executed) fans out the `pushToHubSpotForProperty` + `cascadeTeslaPowerHubLinkToZuperJobs` for every property — same paths the regular sync uses, just kicked off all at once.

### Step 4 — Verify on Brotherton

After backfill completes, on Brotherton's HubSpot Property + Deal + Ticket records you should see:

```
Tesla Gateway Serial:    CN322320G1H00M
Tesla Powerwall Serials: TG123105001YFE
Tesla Inverter Serial:   ADU23270I001VE
Tesla Meter Serial:      VAH5282AB4159
Tesla Hardware Summary:  Gateway: CN322320G1H00M (1232100-10-H, 13.5 kWh, 5.8 kW max)
                         Powerwall: TG123105001YFE (3012170-25-E)
                         Inverter: ADU23270I001VE (1538100-01-F)
                         Meter: VAH5282AB4159 (NEURIO)
```

Same fields on Brotherton's Zuper Property + every linked Zuper Job (cascaded).

## Ongoing maintenance

After this is live, the sync paths take over automatically:
- Every 6h asset-sync cron refreshes `PowerhubSite.devices` from Tesla
- Whenever a site's primary changes (via the existing `resolvePrimarySite` call path), the new denorm columns repopulate on `HubSpotPropertyCache`
- The next regular property-sync push (existing schedule) carries the updated fields to HubSpot + Zuper

No new crons needed.

## Field-update semantics

- All 5 fields can be cleared by Tesla returning empty device arrays — `coerceHubSpotProps` writes `""` for nulls, which clears HubSpot properties cleanly.
- The hardware-summary multi-line field stays stable across syncs (deterministic ordering by device type) so HubSpot/Zuper update events don't fire for spurious diffs.

## Rollback

If something breaks: revert the PR. The new columns on `HubSpotPropertyCache` are nullable and additive — leaving the migration in place is safe. The cross-system push paths fall back to the prior 2-field shape automatically.
