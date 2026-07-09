-- Escalation photo attachments, anchored to dealId (additive)
CREATE TABLE "IdrEscalationPhoto" (
  "id"         TEXT NOT NULL,
  "dealId"     TEXT NOT NULL,
  "blobPath"   TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "caption"    TEXT,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "uploadedBy" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdrEscalationPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdrEscalationPhoto_dealId_idx" ON "IdrEscalationPhoto"("dealId");
