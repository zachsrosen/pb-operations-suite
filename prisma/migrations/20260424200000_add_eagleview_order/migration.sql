-- EagleView TrueDesign auto-pull — purely additive: 2 new enum types + 1 new table.
-- Spec: docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md
-- Plan: docs/superpowers/plans/2026-04-24-eagleview-truedesign-auto-pull.md
--
-- Safe to apply at any time — does NOT touch existing tables, columns, or rows.

-- CreateEnum
CREATE TYPE "EagleViewProduct" AS ENUM ('TDP', 'TDS', 'IA');

-- CreateEnum
CREATE TYPE "EagleViewOrderStatus" AS ENUM ('ORDERED', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EagleViewOrder" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "productCode" "EagleViewProduct" NOT NULL DEFAULT 'TDP',
    "reportId" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "status" "EagleViewOrderStatus" NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "surveyDate" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "estimatedDeliveryAt" TIMESTAMP(3),
    "driveFolderId" TEXT,
    "imageDriveFileId" TEXT,
    "layoutJsonDriveFileId" TEXT,
    "shadeJsonDriveFileId" TEXT,
    "reportPdfDriveFileId" TEXT,
    "reportXmlDriveFileId" TEXT,
    "cost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleViewOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EagleViewOrder_reportId_key" ON "EagleViewOrder"("reportId");

-- CreateIndex
CREATE INDEX "EagleViewOrder_status_orderedAt_idx" ON "EagleViewOrder"("status", "orderedAt");

-- CreateIndex
CREATE INDEX "EagleViewOrder_dealId_idx" ON "EagleViewOrder"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleViewOrder_dealId_productCode_addressHash_key" ON "EagleViewOrder"("dealId", "productCode", "addressHash");
