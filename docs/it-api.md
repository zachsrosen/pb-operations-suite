# PB Operations Suite — IT API

Read-only feeds from the PB Operations Suite, intended for IT's aggregation (SIEM, audit, access-review, offboarding tooling) alongside HubSpot, Google Workspace, Aircall, etc.

All endpoints share a single scoped bearer token — `IT_EXPORT_TOKEN` — valid only for `/api/it/*`. The token cannot write anywhere and cannot reach BOM/Zuper/CRM endpoints.

---

## Endpoints at a glance

| Endpoint | What it returns |
|---|---|
| `GET /api/it/activity-export` | User-action log (logins, scheduling, exports, admin changes, etc.). |
| `GET /api/it/audit-sessions` | Session-level facts (who logged in, from what client, IP/UA, duration, risk). |
| `GET /api/it/anomaly-events` | Risk-scored rule hits against sessions (SIEM alert source). |
| `GET /api/it/user-roster` | Current user directory (roles, capabilities, last login). |

**Base URL (prod):** `https://www.pbtechops.com`

**Auth (all endpoints):**
```
Authorization: Bearer <IT_EXPORT_TOKEN>
```

- `401` — missing or wrong token.
- `403` — token is valid but used on a non-IT route (shouldn't happen if you stick to `/api/it/*`).
- `500` — server-side failure. Retry with backoff.

**Formats (all endpoints):** `json` (default), `ndjson`, `csv`. Response header `x-total-count` exposes the total matching row count for pagination.

**Rotation:** contact Zach (`zach@photonbrothers.com`). Token is stored as a Vercel env var; rotating takes effect on the next deploy.

**Rate limits:** none enforced today. Keep polling reasonable (one request per minute is plenty for incremental pulls).

---

## 1. `GET /api/it/activity-export`

User-action log. One row per meaningful action in the suite.

### Query params

| Param | Type | Description |
|---|---|---|
| `since` | ISO-8601 | `createdAt >= since`. Use your last watermark for incremental pulls. |
| `until` | ISO-8601 | `createdAt <= until`. |
| `type` / `types` | string(s) | Repeat `type=X` or pass CSV via `types=X,Y`. |
| `role` | string, repeatable | Filter by acting user's role. |
| `email` | string | Partial, case-insensitive email match. |
| `userId` | string | Exact internal user ID. |
| `entityType` | string | Filter by entity type touched (e.g. `deal`, `ticket`). |
| `limit` | integer | Default 1000, max 10000. |
| `offset` | integer | Pagination offset. |
| `format` | `json` \| `ndjson` \| `csv` | Default `json`. |

### Activity type groups

| Group | Types |
|---|---|
| Auth | `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `SESSION_EXPIRED` |
| Scheduling | `SURVEY_*`, `INSTALL_*`, `INSPECTION_*` |
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
| Customer portal | `PORTAL_INVITE_*`, `PORTAL_SURVEY_*` |
| Revenue goals | `REVENUE_GOAL_UPDATED` |
| Deal-mirror sync | `DEAL_SYNC_*` |
| Property object | `PROPERTY_CREATED`, `PROPERTY_ASSOCIATION_ADDED`, `PROPERTY_SYNC_FAILED` |
| Estimator | `ESTIMATOR_SUBMISSION`, `ESTIMATOR_OUT_OF_AREA` |
| Role admin | `ROLE_CAPABILITIES_*`, `ROLE_DEFINITION_*`, `USER_EXTRA_ROUTES_CHANGED` |
| On-call | `ON_CALL_POOL_*`, `ON_CALL_PUBLISHED`, `ON_CALL_SWAP_REQUESTED` |

New types are added over time — pull a sample to see distinct `type` values currently in the database.

### Sample response (`format=json`)

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

`nextOffset` is `null` at the end of the result set.

---

## 2. `GET /api/it/audit-sessions`

Session-level facts: who logged in, from what client, IP/UA, when the session started and ended, and whether it was flagged.

### Query params

| Param | Type | Description |
|---|---|---|
| `since` / `until` | ISO-8601 | Filter on `startedAt`. |
| `email` | string | Partial email match (session or linked user). |
| `userId` | string | Exact user ID. |
| `clientType` | string | `BROWSER`, `CLAUDE_CODE`, `CODEX`, `API_CLIENT`, `UNKNOWN`. |
| `environment` | string | `LOCAL`, `PREVIEW`, `PRODUCTION`. |
| `riskLevel` | string, repeatable | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. |
| `activeOnly` | `1` | Only open sessions (no `endedAt`). |
| `limit` | integer | Default 1000, max 10000. |
| `offset` | integer | Pagination offset. |
| `format` | `json` \| `ndjson` \| `csv` | |

### Sample response

```json
{
  "sessions": [
    {
      "id": "cl...",
      "userId": "cl...",
      "userEmail": "jane@photonbrothers.com",
      "userName": "Jane Doe",
      "userRoles": ["OPERATIONS_MANAGER"],
      "clientType": "BROWSER",
      "environment": "PRODUCTION",
      "ipAddress": "1.2.3.4",
      "userAgent": "Mozilla/5.0 ...",
      "deviceFingerprint": "abc...",
      "startedAt": "2026-04-24T09:00:00.000Z",
      "lastActiveAt": "2026-04-24T11:42:19.100Z",
      "endedAt": "2026-04-24T12:02:00.000Z",
      "durationSec": 10920,
      "riskLevel": "LOW",
      "riskScore": 2,
      "anomalyReasons": [],
      "confidence": "HIGH",
      "immediateAlertSentAt": null,
      "criticalAlertSentAt": null,
      "metadata": null
    }
  ],
  "total": 842,
  "limit": 1000,
  "offset": 0,
  "nextOffset": null
}
```

---

## 3. `GET /api/it/anomaly-events`

Every time an anomaly rule fires on an `AuditSession`, a row lands here with the rule name, risk score, evidence blob, and acknowledgement state. This is the SIEM-alert feed.

### Query params

| Param | Type | Description |
|---|---|---|
| `since` / `until` | ISO-8601 | Filter on `createdAt`. |
| `rule` | string, repeatable | Exact rule name (e.g. `impossible_travel`, `new_device`). |
| `riskLevel` | string, repeatable | Filter by the **parent session's** risk level. |
| `email` / `userId` | string | Filter by the session's user. |
| `unacknowledgedOnly` | `1` | Hide rows that have been ack'd by an admin. |
| `minRiskScore` | integer | Only rows with `riskScore >= N`. |
| `limit` | integer | Default 1000, max 10000. |
| `offset` | integer | Pagination offset. |
| `format` | `json` \| `ndjson` \| `csv` | |

### Sample response

```json
{
  "events": [
    {
      "id": "cl...",
      "createdAt": "2026-04-24T11:02:17.402Z",
      "rule": "impossible_travel",
      "riskScore": 85,
      "evidence": {
        "previousIp": "1.2.3.4",
        "previousCity": "Denver",
        "currentIp": "9.9.9.9",
        "currentCity": "Kyiv",
        "elapsedMinutes": 38
      },
      "acknowledgedAt": null,
      "acknowledgedBy": null,
      "acknowledgeNote": null,
      "sessionId": "cl...",
      "session": {
        "startedAt": "2026-04-24T10:20:00.000Z",
        "userId": "cl...",
        "userEmail": "jane@photonbrothers.com",
        "userName": "Jane Doe",
        "userRoles": ["OPERATIONS_MANAGER"],
        "clientType": "BROWSER",
        "environment": "PRODUCTION",
        "ipAddress": "9.9.9.9",
        "userAgent": "Mozilla/5.0 ...",
        "riskLevel": "HIGH"
      }
    }
  ],
  "total": 17,
  "limit": 1000,
  "offset": 0,
  "nextOffset": null
}
```

---

## 4. `GET /api/it/user-roster`

Current user directory — roster, roles, capability booleans, last login, and admin overrides. Snapshot (not a log). Use it for access reviews and offboarding audits.

### Query params

| Param | Type | Description |
|---|---|---|
| `email` | string | Partial, case-insensitive email match. |
| `role` | string, repeatable | Only users with at least one of the named roles. |
| `hasRoles` | `1` | Only users with at least one role assigned. |
| `activeDays` | integer | Only users whose `lastLoginAt` is within the last N days. |
| `limit` | integer | Default 500, max 5000. |
| `offset` | integer | Pagination offset. |
| `format` | `json` \| `ndjson` \| `csv` | |

### Sample response

```json
{
  "users": [
    {
      "id": "cl...",
      "email": "jane@photonbrothers.com",
      "name": "Jane Doe",
      "image": "https://...",
      "roles": ["OPERATIONS_MANAGER"],
      "googleLinked": true,
      "capabilities": {
        "canScheduleSurveys": true,
        "canScheduleInstalls": true,
        "canSyncToZuper": false,
        "canManageUsers": false,
        "canManageAvailability": true,
        "canManageAdders": false
      },
      "extraAllowedRoutes": [],
      "extraDeniedRoutes": [],
      "allowedLocations": ["Westminster", "Centennial"],
      "isImpersonating": false,
      "impersonatingUserId": null,
      "hubspotOwnerId": "52123456",
      "createdAt": "2025-09-14T19:02:00.000Z",
      "updatedAt": "2026-04-20T18:47:11.000Z",
      "lastLoginAt": "2026-04-24T09:00:00.000Z",
      "daysSinceLastLogin": 0
    }
  ],
  "total": 87,
  "limit": 500,
  "offset": 0,
  "nextOffset": null
}
```

---

## Recommended ingest pattern

Pull incrementally using a watermark — one watermark per endpoint.

```bash
# activity-export: watermark = most recent createdAt
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/activity-export?since=2026-04-21T14:03:12Z&format=ndjson&limit=10000"

# audit-sessions: watermark = most recent startedAt
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/audit-sessions?since=2026-04-24T00:00:00Z&format=ndjson&limit=10000"

# anomaly-events: watermark = most recent createdAt
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/anomaly-events?since=2026-04-24T00:00:00Z&unacknowledgedOnly=1&format=ndjson"

# user-roster: snapshot view, no since; refresh daily
curl -H "Authorization: Bearer $IT_EXPORT_TOKEN" \
  "https://www.pbtechops.com/api/it/user-roster?format=csv" > pb-roster.csv
```

For large backfills, paginate with `limit` + `offset` inside a fixed `since`/`until` window.

Results are ordered `createdAt DESC` (activity, anomalies) or `startedAt DESC` (sessions) or `lastLoginAt DESC` (roster). If your pipeline needs ascending order, sort after ingest.

---

## Contacts / ownership

- **Owner:** Zach Rosen (`zach@photonbrothers.com`).
- **Source:** `src/app/api/it/*/route.ts` in the `PB-Operations-Suite` repo.
- **Storage:** Neon Postgres (`ActivityLog`, `AuditSession`, `AuditAnomalyEvent`, `User` tables). Retention for activity/session/anomaly data is managed by `/api/cron/audit-retention`.
