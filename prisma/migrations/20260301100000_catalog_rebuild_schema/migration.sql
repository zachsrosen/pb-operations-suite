-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MatchDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- AlterEnum
ALTER TYPE "PushStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "EquipmentSku" ADD COLUMN     "canonicalBrand" TEXT,
ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "canonicalModel" TEXT;

-- AlterTable
ALTER TABLE "PendingCatalogPush" ADD COLUMN     "candidateSkuIds" TEXT[],
ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "CatalogMatchGroup" (
    "id" TEXT NOT NULL,
    "matchGroupKey" TEXT NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "canonicalBrand" TEXT,
    "canonicalModel" TEXT,
    "category" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "memberSources" JSONB NOT NULL,
    "fieldProvenance" JSONB,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "decision" "MatchDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "internalSkuId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogMatchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogMatchGroup_matchGroupKey_key" ON "CatalogMatchGroup"("matchGroupKey");

-- CreateIndex
CREATE INDEX "CatalogMatchGroup_confidence_idx" ON "CatalogMatchGroup"("confidence");

-- CreateIndex
CREATE INDEX "CatalogMatchGroup_decision_idx" ON "CatalogMatchGroup"("decision");

-- CreateIndex
CREATE INDEX "CatalogMatchGroup_needsReview_idx" ON "CatalogMatchGroup"("needsReview");

-- CreateIndex
CREATE INDEX "EquipmentSku_canonicalKey_idx" ON "EquipmentSku"("canonicalKey");

-- CreateIndex
CREATE INDEX "EquipmentSku_canonicalBrand_canonicalModel_idx" ON "EquipmentSku"("canonicalBrand", "canonicalModel");

-- CreateIndex
CREATE INDEX "PendingCatalogPush_canonicalKey_status_idx" ON "PendingCatalogPush"("canonicalKey", "status");

-- CreateIndex
CREATE INDEX "PendingCatalogPush_source_idx" ON "PendingCatalogPush"("source");

-- CreateIndex
CREATE INDEX "PendingCatalogPush_expiresAt_idx" ON "PendingCatalogPush"("expiresAt");
