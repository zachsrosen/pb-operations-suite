# Security Runbook

## Production Baseline

Set these environment variables in production:

- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_EMAIL_DOMAIN`
- `DEPLOYMENT_WEBHOOK_SECRET`

Optional hardening variables:

- `AUTH_TOKEN_SECRET`
- `AUTH_SALT`
- `API_SECRET_TOKEN`

Keep these disabled in production unless explicitly needed:

- `DEBUG_API_ENABLED=false`
- `ENABLE_ADMIN_ROLE_RECOVERY=false`

## Webhook Security

`/api/deployment` requires `DEPLOYMENT_WEBHOOK_SECRET` in production.

Supported authentication modes:

- `Authorization: Bearer <secret>`
- `x-webhook-secret: <secret>`
- `x-vercel-signature` HMAC digest (`sha1`/`sha256`, with or without prefix)

## Access Control Model

- Authentication: NextAuth Google OAuth
- Authorization: role-based route checks in middleware + server-side role checks on admin APIs
- JWT role is synced from database and refreshed periodically

## Sensitive Endpoints

- `/api/debug` is admin-only and disabled in production by default
- `/api/admin/fix-role` is disabled unless `ENABLE_ADMIN_ROLE_RECOVERY=true`

## Secret Rotation

When rotating secrets:

1. Rotate `NEXTAUTH_SECRET` (sessions/JWT invalidation expected).
2. Rotate `DEPLOYMENT_WEBHOOK_SECRET` and update webhook sender config.
3. Rotate `HUBSPOT_ACCESS_TOKEN` and `GOOGLE_CLIENT_SECRET`.
4. Verify auth, admin pages, and webhook deliveries after deployment.

## Validation Commands

```bash
npm run preflight
npm run preflight:prod
npm run lint
npm test -- --runInBand
```
