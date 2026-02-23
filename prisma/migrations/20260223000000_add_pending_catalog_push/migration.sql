-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PendingCatalogPush" (
    "id" TEXT NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unitSpec" TEXT,
    "unitLabel" TEXT,
    "systems" TEXT[],
    "requestedBy" TEXT NOT NULL,
    "dealId" TEXT,
    "note" TEXT,
    "internalSkuId" TEXT,
    "zohoItemId" TEXT,
    "hubspotProductId" TEXT,
    "zuperItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PendingCatalogPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingCatalogPush_status_idx" ON "PendingCatalogPush"("status");

-- CreateIndex
CREATE INDEX "PendingCatalogPush_requestedBy_idx" ON "PendingCatalogPush"("requestedBy");
