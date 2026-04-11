-- CreateTable
CREATE TABLE "CommsGmailToken" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailAccessToken" TEXT NOT NULL,
    "gmailRefreshToken" TEXT NOT NULL,
    "gmailTokenExpiry" BIGINT NOT NULL DEFAULT 0,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scopes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsGmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsAiMemory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsAiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsUserState" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailHistoryId" TEXT NOT NULL DEFAULT '',
    "chatLastSyncAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsUserState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommsGmailToken_userId_key" ON "CommsGmailToken"("userId");

-- CreateIndex
CREATE INDEX "CommsAiMemory_userId_kind_idx" ON "CommsAiMemory"("userId", "kind");

-- CreateIndex
CREATE INDEX "CommsAiMemory_userId_kind_key_idx" ON "CommsAiMemory"("userId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CommsUserState_userId_key" ON "CommsUserState"("userId");

-- AddForeignKey
ALTER TABLE "CommsGmailToken" ADD CONSTRAINT "CommsGmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsAiMemory" ADD CONSTRAINT "CommsAiMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsUserState" ADD CONSTRAINT "CommsUserState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
