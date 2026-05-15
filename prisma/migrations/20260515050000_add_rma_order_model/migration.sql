-- CreateEnum
CREATE TYPE "RmaStatus" AS ENUM ('DRAFT', 'SO_CREATED', 'RETURN_PENDING', 'CLOSED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'RMA_ORDER_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'RMA_SO_CREATED';

-- AlterEnum
ALTER TYPE "PowerhubAlertSeverity" ADD VALUE 'RMA';

-- CreateTable
CREATE TABLE "RmaOrder" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketSubject" TEXT NOT NULL,
    "status" "RmaStatus" NOT NULL DEFAULT 'DRAFT',
    "outboundItems" JSONB NOT NULL,
    "zohoSoId" TEXT,
    "zohoSoNumber" TEXT,
    "inboundItems" JSONB,
    "returnReceivedAt" TIMESTAMP(3),
    "powerhubAlertId" TEXT,
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "pbLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RmaOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RmaOrder_ticketId_idx" ON "RmaOrder"("ticketId");

-- CreateIndex
CREATE INDEX "RmaOrder_status_idx" ON "RmaOrder"("status");

-- CreateIndex
CREATE INDEX "RmaOrder_zohoSoId_idx" ON "RmaOrder"("zohoSoId");

-- CreateIndex
CREATE INDEX "RmaOrder_powerhubAlertId_idx" ON "RmaOrder"("powerhubAlertId");
