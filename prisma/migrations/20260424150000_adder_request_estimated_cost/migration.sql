-- Add estimatedCost column to AdderRequest (rep's best guess at our cost, not price).
ALTER TABLE "AdderRequest" ADD COLUMN IF NOT EXISTS "estimatedCost" DOUBLE PRECISION;
