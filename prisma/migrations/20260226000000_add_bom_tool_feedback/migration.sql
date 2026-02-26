-- CreateTable: BomToolFeedback for BOM extraction improvement feedback
CREATE TABLE IF NOT EXISTS "BomToolFeedback" (
    "id" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "dealId" TEXT,
    "dealName" TEXT,
    "submittedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BomToolFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BomToolFeedback_createdAt_idx" ON "BomToolFeedback"("createdAt");
