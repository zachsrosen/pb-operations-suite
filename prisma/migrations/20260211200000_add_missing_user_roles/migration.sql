-- Add missing UserRole enum values that were defined in schema but never migrated
-- These roles have been in use in the application code (role-permissions.ts, middleware.ts)
-- but were missing from the database, causing constraint violations on role assignment.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATIONS';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROJECT_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TECH_OPS';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DESIGNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PERMITTING';
