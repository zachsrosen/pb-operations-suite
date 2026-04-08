-- CreateTable
CREATE TABLE "EagleViewImagery" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "imageUrn" TEXT NOT NULL,
    "captureDate" TIMESTAMP(3),
    "gsd" DOUBLE PRECISION,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "thumbnailUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "fetchedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleViewImagery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EagleViewImagery_dealId_key" ON "EagleViewImagery"("dealId");
