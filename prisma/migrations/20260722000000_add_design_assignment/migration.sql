-- CreateTable
CREATE TABLE "DesignAssignment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "assigneeEmail" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "note" TEXT,
    "dueDate" TIMESTAMP(3),
    "tab" TEXT NOT NULL,
    "statusAtAssignment" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "clearedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignAssignment_assigneeEmail_clearedAt_idx" ON "DesignAssignment"("assigneeEmail", "clearedAt");

-- CreateIndex
CREATE INDEX "DesignAssignment_dealId_idx" ON "DesignAssignment"("dealId");
