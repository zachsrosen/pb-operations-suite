-- CreateTable
CREATE TABLE "PeDocChangeLog" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "dealName" TEXT,
    "docName" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "oldNotes" TEXT,
    "newNotes" TEXT,
    "syncedBy" TEXT NOT NULL DEFAULT 'pe-scraper-sync',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeDocChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeDocChangeLog_createdAt_idx" ON "PeDocChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "PeDocChangeLog_dealId_idx" ON "PeDocChangeLog"("dealId");
