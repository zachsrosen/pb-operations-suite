-- CreateTable
CREATE TABLE "PendingPropertyOverride" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "propertyName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPropertyOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingPropertyOverride_executeAfter_idx" ON "PendingPropertyOverride"("executeAfter");

-- CreateIndex
CREATE INDEX "PendingPropertyOverride_dealId_idx" ON "PendingPropertyOverride"("dealId");
