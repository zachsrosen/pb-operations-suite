-- CreateEnum
CREATE TYPE "AdderCategory" AS ENUM ('ELECTRICAL', 'ROOFING', 'STRUCTURAL', 'SITEWORK', 'LOGISTICS', 'DESIGN', 'PERMITTING', 'REMOVAL', 'ORG', 'MISC');

-- CreateEnum
CREATE TYPE "AdderUnit" AS ENUM ('FLAT', 'PER_MODULE', 'PER_KW', 'PER_LINEAR_FT', 'PER_HOUR', 'TIERED');

-- CreateEnum
CREATE TYPE "AdderType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "AdderDirection" AS ENUM ('ADD', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "TriageAnswerType" AS ENUM ('BOOLEAN', 'NUMERIC', 'CHOICE', 'MEASUREMENT');

-- CreateEnum
CREATE TYPE "AdderSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AdderSyncTrigger" AS ENUM ('ON_SAVE', 'CRON', 'MANUAL');

-- CreateTable
CREATE TABLE "Adder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AdderCategory" NOT NULL,
    "type" "AdderType" NOT NULL DEFAULT 'FIXED',
    "direction" "AdderDirection" NOT NULL DEFAULT 'ADD',
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" TEXT,
    "triggerCondition" TEXT,
    "triageQuestion" TEXT,
    "triageAnswerType" "TriageAnswerType",
    "triageChoices" JSONB,
    "triggerLogic" JSONB,
    "photosRequired" BOOLEAN NOT NULL DEFAULT false,
    "unit" "AdderUnit" NOT NULL,
    "basePrice" DECIMAL(65,30) NOT NULL,
    "baseCost" DECIMAL(65,30) NOT NULL,
    "marginTarget" DECIMAL(65,30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "openSolarId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdderShopOverride" (
    "id" TEXT NOT NULL,
    "adderId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "priceDelta" DECIMAL(65,30) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdderShopOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdderRevision" (
    "id" TEXT NOT NULL,
    "adderId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeNote" TEXT,

    CONSTRAINT "AdderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdderSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "AdderSyncRunStatus" NOT NULL,
    "trigger" "AdderSyncTrigger" NOT NULL,
    "addersPushed" INTEGER NOT NULL DEFAULT 0,
    "addersFailed" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB,

    CONSTRAINT "AdderSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRun" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "prelimAddress" JSONB,
    "runBy" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answers" JSONB NOT NULL,
    "recommendedAdders" JSONB NOT NULL,
    "selectedAdders" JSONB NOT NULL,
    "photos" JSONB,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "hubspotLineItemIds" JSONB,
    "notes" TEXT,

    CONSTRAINT "TriageRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Adder_code_key" ON "Adder"("code");

-- CreateIndex
CREATE INDEX "Adder_category_active_idx" ON "Adder"("category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AdderShopOverride_adderId_shop_key" ON "AdderShopOverride"("adderId", "shop");

-- CreateIndex
CREATE INDEX "AdderRevision_adderId_changedAt_idx" ON "AdderRevision"("adderId", "changedAt");

-- CreateIndex
CREATE INDEX "TriageRun_dealId_runAt_idx" ON "TriageRun"("dealId", "runAt");

-- AddForeignKey
ALTER TABLE "AdderShopOverride" ADD CONSTRAINT "AdderShopOverride_adderId_fkey" FOREIGN KEY ("adderId") REFERENCES "Adder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdderRevision" ADD CONSTRAINT "AdderRevision_adderId_fkey" FOREIGN KEY ("adderId") REFERENCES "Adder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

