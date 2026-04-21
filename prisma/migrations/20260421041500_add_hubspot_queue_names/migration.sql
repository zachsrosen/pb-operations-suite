-- CreateTable
CREATE TABLE "HubspotQueueName" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubspotQueueName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubspotQueueName_queueId_key" ON "HubspotQueueName"("queueId");

-- CreateIndex
CREATE INDEX "HubspotQueueName_name_idx" ON "HubspotQueueName"("name");
