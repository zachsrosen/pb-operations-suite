-- AlterTable: add zohoSoId to ProjectBomSnapshot
ALTER TABLE "ProjectBomSnapshot" ADD COLUMN IF NOT EXISTS "zohoSoId" TEXT;
