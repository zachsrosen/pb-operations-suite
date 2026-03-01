-- Session-aware audit trail: AuditSession, AuditAnomalyEvent, SystemConfig,
-- and ActivityLog risk fields.

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('BROWSER', 'CLAUDE_CODE', 'CODEX', 'API_CLIENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('LOCAL', 'PREVIEW', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- DropIndex (removed unique constraint that no longer exists in schema)
DROP INDEX IF EXISTS "BomPipelineRun_dealId_running_unique";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "auditSessionId" TEXT,
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "riskScore" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AuditSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "clientType" "ClientType" NOT NULL DEFAULT 'UNKNOWN',
    "environment" "Environment" NOT NULL DEFAULT 'LOCAL',
    "deviceFingerprint" TEXT,
    "fingerprintVersion" INTEGER,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "riskScore" INTEGER NOT NULL DEFAULT 1,
    "anomalyReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "immediateAlertSentAt" TIMESTAMP(3),
    "criticalAlertSentAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "AuditSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditAnomalyEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "acknowledgeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditAnomalyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditSession_userId_lastActiveAt_idx" ON "AuditSession"("userId", "lastActiveAt");

-- CreateIndex
CREATE INDEX "AuditSession_startedAt_idx" ON "AuditSession"("startedAt");

-- CreateIndex
CREATE INDEX "AuditSession_riskLevel_idx" ON "AuditSession"("riskLevel");

-- CreateIndex
CREATE INDEX "AuditSession_environment_idx" ON "AuditSession"("environment");

-- CreateIndex
CREATE INDEX "AuditSession_userId_clientType_ipAddress_endedAt_idx" ON "AuditSession"("userId", "clientType", "ipAddress", "endedAt");

-- CreateIndex
CREATE INDEX "AuditAnomalyEvent_sessionId_idx" ON "AuditAnomalyEvent"("sessionId");

-- CreateIndex
CREATE INDEX "AuditAnomalyEvent_rule_createdAt_idx" ON "AuditAnomalyEvent"("rule", "createdAt");

-- CreateIndex
CREATE INDEX "AuditAnomalyEvent_acknowledgedAt_idx" ON "AuditAnomalyEvent"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "ActivityLog_auditSessionId_createdAt_idx" ON "ActivityLog"("auditSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSession" ADD CONSTRAINT "AuditSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAnomalyEvent" ADD CONSTRAINT "AuditAnomalyEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
