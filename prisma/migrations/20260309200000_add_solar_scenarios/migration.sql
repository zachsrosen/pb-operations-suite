-- AlterTable: Add scenarios JSON column to SolarProject
-- Stores an array of scenario objects (equipment overrides + cached results)
ALTER TABLE "SolarProject" ADD COLUMN "scenarios" JSONB;
