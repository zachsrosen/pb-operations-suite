-- Option D: per-user route overrides.
--
-- Adds two TEXT[] columns to User: extras that AUGMENT and OVERRIDE the role
-- union in `resolveUserAccess`. Denied wins over allowed within the same user.
-- Admin-editable via /admin/users.
--
-- Both are NOT NULL with an empty-array default so existing rows don't need
-- backfill. Idempotent: safe to re-run.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraAllowedRoutes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraDeniedRoutes"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Add the audit-activity enum value. `ADD VALUE IF NOT EXISTS` keeps the
-- migration idempotent; PG12+ allows this inside a transaction so long as
-- the value isn't used in the same transaction (it isn't — ActivityLog
-- writes happen in separate transactions from this migration).
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'USER_EXTRA_ROUTES_CHANGED';
