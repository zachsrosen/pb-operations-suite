-- CreateTable
CREATE TABLE "SopTab" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopSection" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "sidebarGroup" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dotColor" TEXT NOT NULL DEFAULT 'blue',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopRevision" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopTab_sortOrder_idx" ON "SopTab"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SopSection_tabId_sortOrder_key" ON "SopSection"("tabId", "sortOrder");

-- CreateIndex
CREATE INDEX "SopSection_tabId_sortOrder_idx" ON "SopSection"("tabId", "sortOrder");

-- CreateIndex
CREATE INDEX "SopRevision_sectionId_createdAt_idx" ON "SopRevision"("sectionId", "createdAt");

-- CreateIndex
CREATE INDEX "SopRevision_editedBy_idx" ON "SopRevision"("editedBy");

-- AddForeignKey
ALTER TABLE "SopSection" ADD CONSTRAINT "SopSection_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "SopTab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopRevision" ADD CONSTRAINT "SopRevision_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "SopSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
