# HubSpot Integration Guide — Property Object Section

> Paste this into `docs/hubspot-integration-guide.docx` during runbook step 7.4.2.
> Substitute `<OBJECT_TYPE_ID>` and each `<ASSOC_*_ID>` with the values the bootstrap script printed in 7.2.2.

---

## Custom Objects — Property

### Purpose

The Property custom object anchors HubSpot records (deals, tickets, contacts, companies) to a canonical physical address. One property per normalized address. Dedup is enforced by a SHA-256 hash of `street+unit+city+state+zip` stored in the Neon cache (`HubSpotPropertyCache.addressHash`), with `googlePlaceId` as the canonical key when Google returns one.

### Object Identity

| Field | Value |
|---|---|
| Object type ID | `<OBJECT_TYPE_ID>` |
| Singular label | Property |
| Plural label | Properties |
| Primary display property | `fullAddress` |
| Secondary display property | `pbLocation` |
| Searchable properties | `fullAddress`, `streetAddress`, `city`, `zip`, `hubspotObjectId` |

### Property Groups

1. `property_identity` — Identity + address
2. `property_parcel` — Parcel / legal
3. `property_structure` — Structure attributes
4. `property_roof` — Roof
5. `property_risk` — Risk / environmental
6. `property_electrical` — Electrical service
7. `property_rollups` — Deal / ticket / equipment rollups (denormalized from cache)
8. `property_geo_links` — PB shop / AHJ / utility resolution
9. `property_sync_meta` — Source-of-truth, last sync timestamp
10. `property_notes` — Free-form

See `scripts/create-hubspot-property-object.ts` for the authoritative field definitions.

### Labeled Associations (Contact ↔ Property)

| Label | Forward Association ID |
|---|---|
| Current Owner | `<ASSOC_CURRENT_OWNER_ID>` |
| Previous Owner | `<ASSOC_PREVIOUS_OWNER_ID>` |
| Tenant | `<ASSOC_TENANT_ID>` |
| Property Manager | `<ASSOC_PROPERTY_MANAGER_ID>` |
| Authorized Contact | `<ASSOC_AUTHORIZED_CONTACT_ID>` |

**V1 invariant:** no auto-demotion. A contact's address change creates a NEW Property and associates the contact as `Current Owner` to the new one. The old Property keeps the contact as `Current Owner` — it is never automatically demoted to `Previous Owner`. A follow-up spec covers owner-demotion UX when a "sold" event is detected.

### Labeled Associations (Company ↔ Property)

| Label | Forward Association ID |
|---|---|
| Owner | `<ASSOC_COMPANY_OWNER_ID>` |
| Manager | `<ASSOC_COMPANY_MANAGER_ID>` |

### Webhooks

- Subscription: `contact.propertyChange` for `address`, `city`, `state`, `zip`, `country`.
- Target: `https://<prod deploy URL>/api/webhooks/hubspot/property`
- Kill switch: `PROPERTY_SYNC_ENABLED=false` in Vercel env — handler returns 200 immediately without cache writes.
- Idempotency: webhook events are deduped via `PropertyWebhookEvent` (DB-backed; expires after N days per cron).

### Backfill

- Script: `scripts/backfill-properties.ts`
- Phases: contacts → deals → tickets → rollups (resumable; tracked in `PropertyBackfillRun`).
- Requires `PROPERTY_SYNC_ENABLED=true` in the environment where the script runs.
- Limit with `BACKFILL_LIMIT=N` for dry runs.

### Reconcile

- Cron: daily 9am, path `/api/cron/property-reconcile` (schedule in `vercel.json`).
- Drift repair: re-fetches any property touched in the last 24h (watermark-driven via `PropertySyncWatermark`) and corrects cache divergence.

### Env vars required in Vercel prod

```
HUBSPOT_PROPERTY_OBJECT_TYPE                      = <OBJECT_TYPE_ID>
HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER      = <ASSOC_CURRENT_OWNER_ID>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PREVIOUS_OWNER     = <ASSOC_PREVIOUS_OWNER_ID>
HUBSPOT_PROPERTY_CONTACT_ASSOC_TENANT             = <ASSOC_TENANT_ID>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PROPERTY_MANAGER   = <ASSOC_PROPERTY_MANAGER_ID>
HUBSPOT_PROPERTY_CONTACT_ASSOC_AUTHORIZED_CONTACT = <ASSOC_AUTHORIZED_CONTACT_ID>
HUBSPOT_PROPERTY_COMPANY_ASSOC_OWNER              = <ASSOC_COMPANY_OWNER_ID>
HUBSPOT_PROPERTY_COMPANY_ASSOC_MANAGER            = <ASSOC_COMPANY_MANAGER_ID>
PROPERTY_SYNC_ENABLED                             = true
NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED             = true
```

### Known gaps (v1)

- ATTOM-sourced fields (yearBuilt, squareFootage, roofMaterial, etc.) are null until ATTOM integration ships.
- Dedicated `/dashboards/properties` page is not yet built.
- In-app Property edit UI is not yet built.
- Historical ownership timeline inference is not yet built.
- Geo-polygon AHJ/Utility resolution replaces the current cascade in a follow-up spec.
