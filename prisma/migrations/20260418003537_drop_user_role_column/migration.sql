-- Migration: Drop legacy User.role column
-- Phase 2B: all code now reads User.roles[] exclusively.
-- The dual-write to role was removed in updateUserRoles (Part 2B commit 2).
--
-- HUMAN ACTION REQUIRED: run scripts/migrate-prod.sh CONFIRM to apply this.
-- DO NOT run prisma migrate deploy automatically.

-- Drop the index on the legacy role column
DROP INDEX IF EXISTS "User_role_idx";

-- Drop the legacy single-role column
ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
