-- CreateTable
CREATE TABLE "GoalsDigestSnapshot" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "goals" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalsDigestSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalsDigestSnapshot_weekKey_location_key" ON "GoalsDigestSnapshot"("weekKey", "location");

-- CreateIndex
CREATE INDEX "GoalsDigestSnapshot_location_idx" ON "GoalsDigestSnapshot"("location");
