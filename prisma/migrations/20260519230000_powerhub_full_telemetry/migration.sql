-- Expand PowerhubTelemetrySnapshot with all Tesla-available signals (~46 new cols)
-- Spec: capture every signal Tesla's /v2/telemetry/last returns for each site.
-- All additive + nullable → zero risk to existing queries.

ALTER TABLE "PowerhubTelemetrySnapshot"
  -- Power flows (instantaneous)
  ADD COLUMN "solarPowerRgmW"             DOUBLE PRECISION,
  ADD COLUMN "solarReactivePowerVar"      DOUBLE PRECISION,
  ADD COLUMN "solarRealPowerLimitW"       DOUBLE PRECISION,
  ADD COLUMN "batteryChargePowerW"        DOUBLE PRECISION,
  ADD COLUMN "batteryDischargePowerW"     DOUBLE PRECISION,
  ADD COLUMN "batteryReactivePowerVar"    DOUBLE PRECISION,
  ADD COLUMN "batteryTargetPowerW"        DOUBLE PRECISION,
  ADD COLUMN "batteryTargetReactiveVar"   DOUBLE PRECISION,
  ADD COLUMN "batteryMaxChargeW"          DOUBLE PRECISION,
  ADD COLUMN "batteryMaxDischargeW"       DOUBLE PRECISION,
  ADD COLUMN "estimatedBatteryNextPeriodW" DOUBLE PRECISION,
  ADD COLUMN "gridServicesPowerW"         DOUBLE PRECISION,
  -- Battery state
  ADD COLUMN "batteryNominalCapacityWh"   DOUBLE PRECISION,
  ADD COLUMN "backupReservePercent"       DOUBLE PRECISION,
  ADD COLUMN "batteryFault"               BOOLEAN,
  -- Cumulative energy
  ADD COLUMN "solarEnergyImportedWh"      DOUBLE PRECISION,
  ADD COLUMN "solarEnergyExportedRgmWh"   DOUBLE PRECISION,
  ADD COLUMN "batteryEnergyImportedWh"    DOUBLE PRECISION,
  ADD COLUMN "batteryEnergyExportedWh"    DOUBLE PRECISION,
  ADD COLUMN "loadEnergyImportedWh"       DOUBLE PRECISION,
  ADD COLUMN "solarToLoadEnergyWh"        DOUBLE PRECISION,
  ADD COLUMN "solarToBatteryEnergyWh"     DOUBLE PRECISION,
  ADD COLUMN "batteryToLoadEnergyWh"      DOUBLE PRECISION,
  ADD COLUMN "gridServicesEnergyInWh"     DOUBLE PRECISION,
  ADD COLUMN "gridServicesEnergyOutWh"    DOUBLE PRECISION,
  -- Grid quality
  ADD COLUMN "voltageV"                   DOUBLE PRECISION,
  ADD COLUMN "gridVoltageV"               DOUBLE PRECISION,
  ADD COLUMN "chassisVoltageV"            DOUBLE PRECISION,
  ADD COLUMN "frequencyHz"                DOUBLE PRECISION,
  -- Grid / island state
  ADD COLUMN "islandMode"                 TEXT,
  ADD COLUMN "islanderDisconnected"       BOOLEAN,
  ADD COLUMN "breakerOpenStatus"          BOOLEAN,
  ADD COLUMN "gridReadySync"              BOOLEAN,
  ADD COLUMN "offGridFaultState"          TEXT,
  ADD COLUMN "loadsDropped"               BOOLEAN,
  ADD COLUMN "systemShutdown"             BOOLEAN,
  -- Operational + control
  ADD COLUMN "opticasterReasonCode"       TEXT,
  ADD COLUMN "isPrimaryGateway"           BOOLEAN,
  ADD COLUMN "waitForUserLowSoe"          BOOLEAN,
  ADD COLUMN "waitForUserManualBackup"    BOOLEAN,
  ADD COLUMN "waitForUserNoInverters"     BOOLEAN,
  ADD COLUMN "waitForUserRetriesDone"     BOOLEAN,
  -- Comms health
  ADD COLUMN "commsBattery"               BOOLEAN,
  ADD COLUMN "commsBatteryMeter"          BOOLEAN,
  ADD COLUMN "commsSiteMeter"             BOOLEAN,
  ADD COLUMN "commsSolarMeter"            BOOLEAN,
  -- Rate plan
  ADD COLUMN "energyBuyPrice"             DOUBLE PRECISION,
  ADD COLUMN "energySellPrice"            DOUBLE PRECISION,
  ADD COLUMN "customerEnergyBuyPrice"     DOUBLE PRECISION,
  ADD COLUMN "customerEnergySellPrice"    DOUBLE PRECISION;

-- Expand PowerhubAlert with richer Tesla-provided metadata
ALTER TABLE "PowerhubAlert"
  ADD COLUMN "teslaAlertId"         TEXT,
  ADD COLUMN "alias"                TEXT,
  ADD COLUMN "ecuPart"              TEXT,
  ADD COLUMN "ecuSerial"            TEXT,
  ADD COLUMN "bcPart"               TEXT,
  ADD COLUMN "bcSerial"             TEXT,
  ADD COLUMN "toolboxId"            TEXT,
  ADD COLUMN "alertTags"            JSONB,
  ADD COLUMN "symptomCodes"         JSONB,
  ADD COLUMN "supportAutoTicketUrl" TEXT;
