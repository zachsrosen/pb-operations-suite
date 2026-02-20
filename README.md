# PB Operations Suite

Operational dashboards and admin tooling for Photon Brothers workflows (HubSpot + Zuper + Google Workspace).

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Required Environment Variables

- `HUBSPOT_ACCESS_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `ALLOWED_EMAIL_DOMAIN`

## Production Security Variables

- `DEPLOYMENT_WEBHOOK_SECRET` for `/api/deployment` webhook validation
- `API_SECRET_TOKEN` for bearer-protected external API access (optional)
- `AUTH_TOKEN_SECRET` and `AUTH_SALT` for auth-token hardening (optional)
- `DEBUG_API_ENABLED` should remain `false` in production
- `ENABLE_ADMIN_ROLE_RECOVERY` should remain `false` in production

## Optional Integrations

- `ZOHO_INVENTORY_ORG_ID` + Zoho credentials to enable `POST /api/inventory/sync-zoho` (Zoho Inventory -> PB stock sync)

## Documentation

- Full setup and deployment details: `/Users/zach/Downloads/PB-Operations-Suite/SETUP.md`
- Security runbook: `/Users/zach/Downloads/PB-Operations-Suite/SECURITY.md`
