-- Rename energyBalance → homeConsumptionConfig on SolarProject
-- This column stores home consumption configuration (annualKwh, monthlyKwh, etc.),
-- NOT the recomputable energy balance counters (totalProduction, selfConsumed, etc.).

ALTER TABLE "SolarProject" RENAME COLUMN "energyBalance" TO "homeConsumptionConfig";
