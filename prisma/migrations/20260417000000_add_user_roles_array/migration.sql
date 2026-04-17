-- Add `roles` column as a UserRole[] with empty default, then backfill from existing `role` column.
-- Dual-write is handled at the application layer — see src/lib/db.ts updateUserRoles.
-- The legacy `role` column is dropped in a follow-up migration (Phase 2).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] NOT NULL DEFAULT '{}';

-- Backfill: every existing user gets roles = [role]. Idempotent via the `= '{}'` guard.
UPDATE "User"
SET "roles" = ARRAY["role"]::"UserRole"[]
WHERE "roles" = '{}';
