-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EquipmentCategory" ADD VALUE 'BATTERY_EXPANSION';
ALTER TYPE "EquipmentCategory" ADD VALUE 'OPTIMIZER';
ALTER TYPE "EquipmentCategory" ADD VALUE 'GATEWAY';
ALTER TYPE "EquipmentCategory" ADD VALUE 'D_AND_R';
ALTER TYPE "EquipmentCategory" ADD VALUE 'SERVICE';
ALTER TYPE "EquipmentCategory" ADD VALUE 'ADDER_SERVICES';
ALTER TYPE "EquipmentCategory" ADD VALUE 'TESLA_SYSTEM_COMPONENTS';
ALTER TYPE "EquipmentCategory" ADD VALUE 'PROJECT_MILESTONES';

-- AlterTable
ALTER TABLE "EquipmentSku" ADD COLUMN     "hardToProcure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "length" DOUBLE PRECISION,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "width" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PendingCatalogPush" ADD COLUMN     "hardToProcure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "length" DOUBLE PRECISION,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "sellPrice" DOUBLE PRECISION,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "unitCost" DOUBLE PRECISION,
ADD COLUMN     "vendorName" TEXT,
ADD COLUMN     "vendorPartNumber" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "width" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ModuleSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "wattage" DOUBLE PRECISION,
    "efficiency" DOUBLE PRECISION,
    "cellType" TEXT,
    "voc" DOUBLE PRECISION,
    "isc" DOUBLE PRECISION,
    "vmp" DOUBLE PRECISION,
    "imp" DOUBLE PRECISION,
    "tempCoefficient" DOUBLE PRECISION,

    CONSTRAINT "ModuleSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InverterSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "acOutputKw" DOUBLE PRECISION,
    "maxDcInput" DOUBLE PRECISION,
    "phase" TEXT,
    "nominalAcVoltage" TEXT,
    "mpptChannels" INTEGER,
    "maxInputVoltage" DOUBLE PRECISION,
    "inverterType" TEXT,

    CONSTRAINT "InverterSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatterySpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "capacityKwh" DOUBLE PRECISION,
    "energyStorageCapacity" DOUBLE PRECISION,
    "usableCapacityKwh" DOUBLE PRECISION,
    "continuousPowerKw" DOUBLE PRECISION,
    "peakPowerKw" DOUBLE PRECISION,
    "chemistry" TEXT,
    "roundTripEfficiency" DOUBLE PRECISION,
    "nominalVoltage" DOUBLE PRECISION,

    CONSTRAINT "BatterySpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvChargerSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "powerKw" DOUBLE PRECISION,
    "connectorType" TEXT,
    "amperage" DOUBLE PRECISION,
    "voltage" DOUBLE PRECISION,
    "level" TEXT,
    "smartFeatures" BOOLEAN,

    CONSTRAINT "EvChargerSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MountingHardwareSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "mountType" TEXT,
    "material" TEXT,
    "tiltRange" TEXT,
    "windRating" DOUBLE PRECISION,
    "snowLoad" DOUBLE PRECISION,
    "roofAttachment" TEXT,

    CONSTRAINT "MountingHardwareSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectricalHardwareSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "componentType" TEXT,
    "gaugeSize" TEXT,
    "voltageRating" DOUBLE PRECISION,
    "material" TEXT,

    CONSTRAINT "ElectricalHardwareSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayDeviceSpec" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "deviceType" TEXT,
    "connectivity" TEXT,
    "compatibleInverters" TEXT,

    CONSTRAINT "RelayDeviceSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleSpec_skuId_key" ON "ModuleSpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "InverterSpec_skuId_key" ON "InverterSpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "BatterySpec_skuId_key" ON "BatterySpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "EvChargerSpec_skuId_key" ON "EvChargerSpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "MountingHardwareSpec_skuId_key" ON "MountingHardwareSpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectricalHardwareSpec_skuId_key" ON "ElectricalHardwareSpec"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "RelayDeviceSpec_skuId_key" ON "RelayDeviceSpec"("skuId");

-- AddForeignKey
ALTER TABLE "ModuleSpec" ADD CONSTRAINT "ModuleSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InverterSpec" ADD CONSTRAINT "InverterSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatterySpec" ADD CONSTRAINT "BatterySpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvChargerSpec" ADD CONSTRAINT "EvChargerSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MountingHardwareSpec" ADD CONSTRAINT "MountingHardwareSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectricalHardwareSpec" ADD CONSTRAINT "ElectricalHardwareSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayDeviceSpec" ADD CONSTRAINT "RelayDeviceSpec_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "EquipmentSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

