-- CreateEnum
CREATE TYPE "PeDocStatus" AS ENUM ('NOT_UPLOADED', 'UPLOADED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'REJECTED', 'APPROVED');

-- CreateTable
CREATE TABLE "PeDocumentReview" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "docName" TEXT NOT NULL,
    "status" "PeDocStatus" NOT NULL,
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeDocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeDocumentReview_dealId_idx" ON "PeDocumentReview"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "PeDocumentReview_dealId_docName_key" ON "PeDocumentReview"("dealId", "docName");
