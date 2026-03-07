-- CreateEnum
CREATE TYPE "SolarProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SolarProjectVisibility" AS ENUM ('PRIVATE', 'TEAM');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('READ', 'EDIT');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'FEATURE', 'EQUIPMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'RESOLVED', 'WONTFIX');

-- CreateTable
CREATE TABLE "SolarProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "status" "SolarProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "SolarProjectVisibility" NOT NULL DEFAULT 'TEAM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "equipmentConfig" JSONB,
    "stringsConfig" JSONB,
    "siteConditions" JSONB,
    "energyBalance" JSONB,
    "batteryConfig" JSONB,
    "lossProfile" JSONB,
    "geoJsonUrl" TEXT,
    "radianceDxfUrl" TEXT,
    "shadeDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolarProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarProjectRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "analysisResults" JSONB,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarProjectRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "category" "FeedbackCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarProjectShare" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarProjectShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarPendingState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarPendingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarWeatherCache" (
    "id" TEXT NOT NULL,
    "latE3" INTEGER NOT NULL,
    "lngE3" INTEGER NOT NULL,
    "tmyData" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarWeatherCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolarProject_createdById_idx" ON "SolarProject"("createdById");

-- CreateIndex
CREATE INDEX "SolarProject_status_idx" ON "SolarProject"("status");

-- CreateIndex
CREATE INDEX "SolarProject_updatedAt_idx" ON "SolarProject"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SolarProjectRevision_projectId_version_key" ON "SolarProjectRevision"("projectId", "version");

-- CreateIndex
CREATE INDEX "SolarProjectRevision_projectId_idx" ON "SolarProjectRevision"("projectId");

-- CreateIndex
CREATE INDEX "SolarProjectRevision_createdAt_idx" ON "SolarProjectRevision"("createdAt");

-- CreateIndex
CREATE INDEX "SolarFeedback_userId_idx" ON "SolarFeedback"("userId");

-- CreateIndex
CREATE INDEX "SolarFeedback_category_idx" ON "SolarFeedback"("category");

-- CreateIndex
CREATE INDEX "SolarFeedback_createdAt_idx" ON "SolarFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SolarProjectShare_projectId_userId_key" ON "SolarProjectShare"("projectId", "userId");

-- CreateIndex
CREATE INDEX "SolarProjectShare_userId_idx" ON "SolarProjectShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SolarPendingState_projectId_userId_key" ON "SolarPendingState"("projectId", "userId");

-- CreateIndex
CREATE INDEX "SolarPendingState_userId_idx" ON "SolarPendingState"("userId");

-- CreateIndex
CREATE INDEX "SolarPendingState_createdAt_idx" ON "SolarPendingState"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SolarWeatherCache_latE3_lngE3_key" ON "SolarWeatherCache"("latE3", "lngE3");

-- CreateIndex
CREATE INDEX "SolarWeatherCache_fetchedAt_idx" ON "SolarWeatherCache"("fetchedAt");

-- AddForeignKey
ALTER TABLE "SolarProject" ADD CONSTRAINT "SolarProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarProject" ADD CONSTRAINT "SolarProject_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarProjectRevision" ADD CONSTRAINT "SolarProjectRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SolarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarProjectRevision" ADD CONSTRAINT "SolarProjectRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarFeedback" ADD CONSTRAINT "SolarFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarFeedback" ADD CONSTRAINT "SolarFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SolarProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarProjectShare" ADD CONSTRAINT "SolarProjectShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SolarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarProjectShare" ADD CONSTRAINT "SolarProjectShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarPendingState" ADD CONSTRAINT "SolarPendingState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SolarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarPendingState" ADD CONSTRAINT "SolarPendingState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
