-- One-time cleanup: migrate 2 users' legacy role strings to canonical targets.
--
-- Context: the UserRole Prisma enum carries legacy values (MANAGER, DESIGNER,
-- PERMITTING, OWNER) that `normalizeRole` maps to canonical roles at resolve
-- time. Behaviour is identical whether the DB row stores the legacy or
-- canonical value — this cleanup is purely hygiene so the admin UI shows
-- canonical names everywhere.
--
-- Behaviour delta: zero. Verified against `src/lib/role-permissions.ts` —
-- MANAGER → PROJECT_MANAGER, DESIGNER → TECH_OPS.
--
-- Run with:   DATABASE_URL=... npx prisma db execute --file scripts/cleanup-legacy-user-roles.sql
-- Or via:     scripts/migrate-prod.sh is not applicable here (this isn't a schema migration).

-- Replace MANAGER → PROJECT_MANAGER in any User.roles array that contains it.
UPDATE "User"
SET "roles" = ARRAY_REPLACE("roles"::text[], 'MANAGER', 'PROJECT_MANAGER')::"UserRole"[]
WHERE 'MANAGER' = ANY("roles");

-- Replace DESIGNER → TECH_OPS in any User.roles array that contains it.
UPDATE "User"
SET "roles" = ARRAY_REPLACE("roles"::text[], 'DESIGNER', 'TECH_OPS')::"UserRole"[]
WHERE 'DESIGNER' = ANY("roles");

-- Belt-and-suspenders: also clean up PERMITTING → TECH_OPS and OWNER → EXECUTIVE
-- if any rows ever show up. Currently 0 rows each, but the ANY() is cheap.
UPDATE "User"
SET "roles" = ARRAY_REPLACE("roles"::text[], 'PERMITTING', 'TECH_OPS')::"UserRole"[]
WHERE 'PERMITTING' = ANY("roles");

UPDATE "User"
SET "roles" = ARRAY_REPLACE("roles"::text[], 'OWNER', 'EXECUTIVE')::"UserRole"[]
WHERE 'OWNER' = ANY("roles");
