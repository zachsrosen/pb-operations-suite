-- CreateTable
CREATE TABLE "DesignReviewFeedback" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT,
    "rating" TEXT NOT NULL,
    "notes" TEXT,
    "dealId" TEXT,
    "dealName" TEXT,
    "submittedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignReviewFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignReviewFeedback_createdAt_idx" ON "DesignReviewFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "DesignReviewFeedback_reviewId_idx" ON "DesignReviewFeedback"("reviewId");
