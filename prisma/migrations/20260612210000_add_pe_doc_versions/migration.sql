-- CreateTable
CREATE TABLE "PeDocVersion" (
    "id" TEXT NOT NULL,
    "peProjectId" TEXT NOT NULL,
    "peInternalId" TEXT,
    "dealId" TEXT,
    "docName" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,
    "uploadedBy" TEXT,
    "fileName" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeDocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeDocVersion_peProjectId_docName_version_key" ON "PeDocVersion"("peProjectId", "docName", "version");

-- CreateIndex
CREATE INDEX "PeDocVersion_dealId_idx" ON "PeDocVersion"("dealId");

-- CreateIndex
CREATE INDEX "PeDocVersion_uploadedAt_idx" ON "PeDocVersion"("uploadedAt");

-- CreateIndex
CREATE INDEX "PeDocVersion_uploadedBy_idx" ON "PeDocVersion"("uploadedBy");
