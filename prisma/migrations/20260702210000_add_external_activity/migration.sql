-- CreateTable
CREATE TABLE "ExternalActivity" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "dealId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalActivity_source_sourceEventId_key" ON "ExternalActivity"("source", "sourceEventId");

-- CreateIndex
CREATE INDEX "ExternalActivity_source_userEmail_occurredAt_idx" ON "ExternalActivity"("source", "userEmail", "occurredAt");

-- CreateIndex
CREATE INDEX "ExternalActivity_occurredAt_idx" ON "ExternalActivity"("occurredAt");
