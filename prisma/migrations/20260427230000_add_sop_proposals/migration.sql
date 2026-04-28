-- CreateEnum
CREATE TYPE "SopProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SopProposal" (
    "id" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedByName" TEXT,
    "title" TEXT NOT NULL,
    "suggestedTabId" TEXT NOT NULL,
    "suggestedGroup" TEXT,
    "content" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SopProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "promotedSectionId" TEXT,
    "promotedSectionTab" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopProposal_status_createdAt_idx" ON "SopProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SopProposal_submittedBy_idx" ON "SopProposal"("submittedBy");
