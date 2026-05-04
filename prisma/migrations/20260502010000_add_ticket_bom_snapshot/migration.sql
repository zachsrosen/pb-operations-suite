-- CreateTable
CREATE TABLE "TicketBomSnapshot" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketSubject" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bomData" JSONB NOT NULL,
    "sourceFile" TEXT,
    "blobUrl" TEXT,
    "savedBy" TEXT NOT NULL,
    "zohoPurchaseOrders" JSONB,
    "zohoSoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketBomSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketBomSnapshot_ticketId_idx" ON "TicketBomSnapshot"("ticketId");

-- CreateIndex
CREATE INDEX "TicketBomSnapshot_ticketId_version_idx" ON "TicketBomSnapshot"("ticketId", "version");

-- CreateIndex
CREATE INDEX "TicketBomSnapshot_createdAt_idx" ON "TicketBomSnapshot"("createdAt");
