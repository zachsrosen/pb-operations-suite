-- CreateEnum
CREATE TYPE "ServiceSoStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "ServiceSoRequest" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "requestToken" TEXT NOT NULL,
    "zohoSoId" TEXT,
    "zohoSoNumber" TEXT,
    "zohoCustomerId" TEXT,
    "lineItems" JSONB NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "ServiceSoStatus" NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceSoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSoRequest_requestToken_key" ON "ServiceSoRequest"("requestToken");

-- CreateIndex
CREATE INDEX "ServiceSoRequest_dealId_idx" ON "ServiceSoRequest"("dealId");

-- CreateIndex
CREATE INDEX "ServiceSoRequest_createdBy_idx" ON "ServiceSoRequest"("createdBy");
