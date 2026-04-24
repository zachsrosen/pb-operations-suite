# PB Operations Suite — Activity Export API (for IT)

Read-only feed of user activity inside the PB Operations Suite, intended for ingestion into the IT team's user-activity aggregation alongside HubSpot, Google Workspace, Aircall, etc.

---

## Endpoint

```
GET https://www.pbtechops.com/api/it/activity-export
Authorization: Bearer <IT_EXPORT_TOKEN>
```

- **Method:** `GET` only.
- **Auth:** scoped bearer token (`IT_EXPORT_TOKEN`). This token is valid *only* for this endpoint — it cannot read or mutate any other data in the suite.
- **Rotation:** contact Zach (`zach@photonbrothers.com`) to rotate the token. It is stored as a Vercel environment variable on the `pb-operations-suite` project; rotating it in the Vercel dashboard takes effect on the next deploy.
- **Rate limits:** none enforced today. Keep polling reasonable — one request per minute is more than enough for incremental pulls.

---

## What gets logged

Every meaningful user action in the suite writes a row to the `ActivityLog` table. The action taxonomy is grouped below — you'll see these values in the `type` field.

| Group | Types |
|---|---|
| Auth | `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `SESSION_EXPIRED` |
| Scheduling | `SURVEY_SCHEDULED`, `SURVEY_RESCHEDULED`, `SURVEY_CANCELLED`, `SURVEY_COMPLETED`, `INSTALL_SCHEDULED`, `INSTALL_RESCHEDULED`, `INSTALL_CANCELLED`, `INSTALL_COMPLETED`, `INSPECTION_SCHEDULED`, `INSPECTION_RESCHEDULED`, `INSPECTION_CANCELLED`, `INSPECTION_PASSED`, `INSPECTION_FAILED` |
| Zuper sync | `ZUPER_JOB_CREATED`, `ZUPER_JOB_UPDATED`, `ZUPER_JOB_ASSIGNED`, `ZUPER_ASSIGNMENT_FAILED`, `ZUPER_SYNC_ERROR` |
| HubSpot | `HUBSPOT_DEAL_VIEWED`, `HUBSPOT_DEAL_UPDATED`, `HUBSPOT_SYNC_ERROR` |
| Dashboard | `DASHBOARD_VIEWED`, `DASHBOARD_FILTERED`, `PROJECT_VIEWED`, `PROJECT_SEARCHED` |
| Data export | `REPORT_EXPORTED`, `DATA_EXPORTED`, `CSV_DOWNLOADED` |
| User management | `USER_CREATED`, `USER_UPDATED`, `USER_ROLE_CHANGED`, `USER_DELETED`, `USER_PERMISSIONS_CHANGED`, `USER_INVITED` |
| System | `SETTINGS_CHANGED`, `AVAILABILITY_CHANGED`, `ERROR_OCCURRED`, `API_ERROR`, `FEATURE_USED` |
| Inventory | `INVENTORY_RECEIVED`, `INVENTORY_ADJUSTED`, `INVENTORY_ALLOCATED`, `INVENTORY_TRANSFERRED`, `INVENTORY_SKU_SYNCED` |
| Bug reports | `BUG_REPORTED`, `BUG_STATUS_CHANGED` |
| BOM pipeline | `BOM_PIPELINE_STARTED`, `BOM_PIPELINE_COMPLETED`, `BOM_PIPELINE_FAILED` |
| Reviews | `DESIGN_REVIEW_COMPLETED` |
| Customer portal | `PORTAL_INVITE_CREATED`, `PORTAL_INVITE_SENT`, `PORTAL_SURVEY_SCHEDULED`, `PORTAL_SURVEY_RESCHEDULED`, `PORTAL_SURVEY_CANCELLED` |
| Revenue goals | `REVENUE_GOAL_UPDATED` |
| Deal-mirror sync | `DEAL_SYNC_BATCH_COMPLETE`, `DEAL_SYNC_WEBHOOK_RECEIVED`, `DEAL_SYNC_ERROR`, `DEAL_SYNC_DISCREPANCY` |
| Property object | `PROPERTY_CREATED`, `PROPERTY_ASSOCIATION_ADDED`, `PROPERTY_SYNC_FAILED` |
| Estimator | `ESTIMATOR_SUBMISSION`, `ESTIMATOR_OUT_OF_AREA` |
| Role admin | `ROLE_CAPABILITIES_CHANGED`, `ROLE_CAPABILITIES_RESET`, `ROLE_DEFINITION_CHANGED`, `ROLE_DEFINITION_RESET`, `USER_EXTRA_ROUTES_CHANGED` |
| On-call | `ON_CALL_POOL_CREATED`, `ON_CALL_POOL_UPDATED`, `ON_CALL_POOL_MEMBERS_CHANGED`, `ON_CALL_PUBLISHED`, `ON_CALL_SWAP_REQUESTED` |

New types are added over time — to get the live list currently present in the database, pull a sample and look at distinct `type` values.

---

## Query parameters

All parameters are optional. For incremental ingest, always include `since`.

| Param | Type | Description |
|---|---|---|
| `since` | ISO-8601 datetime | Only return rows with `createdAt >= since`. Use your last successful watermark. |
| `until` | ISO-8601 datetime | Upper bound — rows where `createdAt <= until`. |
| `type` | string, repeatable | Filter to one or more activity types. Repeat the param: `?type=LOGIN&type=LOGOUT`. |
| `types` | comma-separated string | Alternate form: `?types=LOGIN,LOGOUT`. |
| `role` | string, repeatable | Filter by acting user's role (e.g. `ADMIN`, `PROJECT_MANAGER`, `TECH_OPS`). |
| `email` | string | Partial, case-insensitive email match. |
| `userId` | string | Exact internal user ID. |
| `entityType` | string | Filter by entity type touched (e.g. `deal`, `ticket`, `project`). |
| `limit` | integer | Page size. Default `1000`, max `10000`. |
| `offset` | integer | Pagination offset. |
| `format` | `json` \| `ndjson` \| `csv` | Response format. Default `json`. |

Response headers:
- `x-total-count` — total matching rows (useful for pagination).

---

## Response shape

### `format=json` (default)

```json
{
  "activities": [
    {
      "id": "clw...",
      "type": "LOGIN",
      "description": "User logged in",
      "createdAt": "2026-04-21T14:03:12.411Z",
      "userId": "clu...",
      "userEmail": "jane@photonbrothers.com",
      "userName": "Jane Doe",
      "userRoles": ["OPERATIONS_MANAGER"],
      "entityType": null,
      "entityId": null,
      "ipAddress": "1.2.3.4",
      "userAgent": "Mozilla/5.0 ...",
      "metadata": { "loginMethod": "google" }
    }
  ],
  "total": 15234,
  "limit": 1000,
  "offset": 0,
  "nextOffset": 1000
}
```

When `nextOffset` is `null`, you've reached the end of the result set.

### `format=ndjson`

One JSON object per line, no wrapper. Best for streaming ingest.

### `format=csv`

Columns: `id, createdAt, type, userEmail, userName, userRoles, entityType, entityId, description, ipAddress, userAgent, metadata`. `userRoles` and `metadata` are JSON-stringified inside the cell.

---

## Recommended ingest pattern

Pull incrementally by `createdAt`, keeping a watermark:

```bash
# first pull — backfill a month
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/activity-export?since=2026-04-01T00:00:00Z&format=ndjson&limit=10000"

# subsequent pulls — use the latest createdAt you've seen
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/activity-export?since=2026-04-21T14:03:12.411Z&format=ndjson&limit=10000"
```

For large backfills, page with `limit` + `offset` within a fixed `since`/`until` window, or narrow the window (e.g. one day at a time).

Results are ordered `createdAt DESC`. If your pipeline requires ascending order, sort after ingest or walk backward through windows.

---

## Error responses

| Status | Meaning |
|---|---|
| `401` | Missing or invalid `Authorization` header. Check the token value. |
| `403` | Token is valid but used on a route outside its scope (shouldn't happen for this URL). |
| `500` | Server-side failure. Retry with backoff; contact Zach if persistent. |

---

## Contacts / ownership

- **Owner:** Zach Rosen (`zach@photonbrothers.com`).
- **Source:** `src/app/api/it/activity-export/route.ts` in the `PB-Operations-Suite` repo.
- **Storage:** Neon Postgres `ActivityLog` table, retained indefinitely (see `/api/cron/audit-retention` for the retention job if that changes).
