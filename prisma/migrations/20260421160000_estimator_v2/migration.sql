-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'ESTIMATOR_SUBMISSION';
ALTER TYPE "ActivityType" ADD VALUE 'ESTIMATOR_OUT_OF_AREA';

-- AlterTable
ALTER TABLE "EquipmentSku" ADD COLUMN "defaultForEstimator" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "EquipmentSku_defaultForEstimator_category_idx" ON "EquipmentSku"("defaultForEstimator", "category");

-- CreateTable
CREATE TABLE "EstimatorRun" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "quoteType" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB,
    "contactSnapshot" JSONB NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "normalizedAddressHash" TEXT,
    "location" TEXT,
    "hubspotContactId" TEXT,
    "hubspotDealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipHash" TEXT,
    "outOfArea" BOOLEAN NOT NULL DEFAULT false,
    "manualQuoteRequest" BOOLEAN NOT NULL DEFAULT false,
    "recaptchaScore" DOUBLE PRECISION,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EstimatorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstimatorRun_token_key" ON "EstimatorRun"("token");

-- CreateIndex
CREATE INDEX "EstimatorRun_email_idx" ON "EstimatorRun"("email");

-- CreateIndex
CREATE INDEX "EstimatorRun_createdAt_idx" ON "EstimatorRun"("createdAt");

-- CreateIndex
CREATE INDEX "EstimatorRun_hubspotDealId_idx" ON "EstimatorRun"("hubspotDealId");

-- CreateIndex
CREATE INDEX "EstimatorRun_expiresAt_idx" ON "EstimatorRun"("expiresAt");

-- CreateIndex
CREATE INDEX "EstimatorRun_normalizedAddressHash_idx" ON "EstimatorRun"("normalizedAddressHash");
