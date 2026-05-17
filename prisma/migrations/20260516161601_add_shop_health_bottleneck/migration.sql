-- CreateTable
CREATE TABLE "ShopHealthBottleneck" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "constraint" TEXT,
    "rootCause" TEXT,
    "actionPlan" TEXT,
    "owner" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopHealthBottleneck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopHealthBottleneck_location_idx" ON "ShopHealthBottleneck"("location");

-- CreateIndex
CREATE INDEX "ShopHealthBottleneck_weekStart_idx" ON "ShopHealthBottleneck"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "ShopHealthBottleneck_location_weekStart_key" ON "ShopHealthBottleneck"("location", "weekStart");

-- AddForeignKey
ALTER TABLE "ShopHealthBottleneck" ADD CONSTRAINT "ShopHealthBottleneck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
