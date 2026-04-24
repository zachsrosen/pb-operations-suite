-- OAuth credentials for shared team mailboxes — workaround for blocked
-- Workspace domain-wide-delegation. Additive; safe to apply before code.

CREATE TABLE "SharedInboxCredential" (
    "id" SERIAL NOT NULL,
    "inboxAddress" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" BIGINT NOT NULL DEFAULT 0,
    "scopes" TEXT NOT NULL DEFAULT '',
    "connectedBy" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshErr" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedInboxCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedInboxCredential_inboxAddress_key"
    ON "SharedInboxCredential"("inboxAddress");
