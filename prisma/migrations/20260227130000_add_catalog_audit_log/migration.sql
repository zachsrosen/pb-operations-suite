-- CreateTable
CREATE TABLE "CatalogAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogAuditLog_skuId_idx" ON "CatalogAuditLog"("skuId");

-- CreateIndex
CREATE INDEX "CatalogAuditLog_deletedByUserId_idx" ON "CatalogAuditLog"("deletedByUserId");
