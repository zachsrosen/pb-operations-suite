-- CreateTable
CREATE TABLE "PeReferenceDoc" (
    "id" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "sourceDealId" TEXT NOT NULL,
    "sourceDealName" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "anthropicFileId" TEXT,
    "anthropicFileExpiry" TIMESTAMP(3),
    "milestone" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isPhoto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeReferenceDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeAvlCache" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeAvlCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeReferenceDoc_checklistItemId_milestone_key" ON "PeReferenceDoc"("checklistItemId", "milestone");

-- CreateIndex
CREATE INDEX "PeReferenceDoc_milestone_idx" ON "PeReferenceDoc"("milestone");
