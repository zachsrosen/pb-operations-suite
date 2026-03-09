-- CreateEnum
CREATE TYPE "SopSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SopSuggestion" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "SopSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "basedOnVersion" INTEGER NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SopSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopSuggestion_status_createdAt_idx" ON "SopSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SopSuggestion_sectionId_idx" ON "SopSuggestion"("sectionId");

-- AddForeignKey
ALTER TABLE "SopSuggestion" ADD CONSTRAINT "SopSuggestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "SopSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
