-- CreateEnum
CREATE TYPE "SolarEquipmentCategory" AS ENUM ('PANEL', 'INVERTER', 'ESS', 'OPTIMIZER');

-- CreateTable
CREATE TABLE "SolarShadeCache" (
    "id" TEXT NOT NULL,
    "latE3" INTEGER NOT NULL,
    "lngE3" INTEGER NOT NULL,
    "shadeData" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarShadeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarCustomEquipment" (
    "id" TEXT NOT NULL,
    "category" "SolarEquipmentCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolarCustomEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolarShadeCache_fetchedAt_idx" ON "SolarShadeCache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SolarShadeCache_latE3_lngE3_key" ON "SolarShadeCache"("latE3", "lngE3");

-- CreateIndex
CREATE INDEX "SolarCustomEquipment_category_idx" ON "SolarCustomEquipment"("category");

-- AddForeignKey
ALTER TABLE "SolarCustomEquipment" ADD CONSTRAINT "SolarCustomEquipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: only active (non-archived) equipment must have unique category+key.
-- Archived entries can reuse keys. This is enforced at the DB level to prevent race conditions.
CREATE UNIQUE INDEX "SolarCustomEquipment_active_key"
ON "SolarCustomEquipment" ("category", "key")
WHERE "isArchived" = false;
