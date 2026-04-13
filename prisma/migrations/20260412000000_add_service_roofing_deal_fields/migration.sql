-- AlterTable: add service pipeline columns to Deal
ALTER TABLE "Deal"
    ADD COLUMN "serviceType" TEXT,
    ADD COLUMN "serviceVisitStatus" TEXT,
    ADD COLUMN "serviceVisitCompleteDate" TIMESTAMP(3),
    ADD COLUMN "serviceAgreementId" TEXT,
    ADD COLUMN "serviceRevisitStatus" TEXT,
    ADD COLUMN "serviceIssueResolved" TEXT,
    ADD COLUMN "serviceNotes" TEXT,
    ADD COLUMN "serviceAccountNumber" TEXT,
    ADD COLUMN "serviceRateEquivalent" TEXT,
    ADD COLUMN "serviceDocumentsUrl" TEXT,
    ADD COLUMN "serviceDocumentsFolderId" TEXT,

-- AlterTable: add roofing / D&R pipeline columns to Deal
    ADD COLUMN "roofType" TEXT,
    ADD COLUMN "roofAge" TEXT,
    ADD COLUMN "currentRoofingMaterial" TEXT,
    ADD COLUMN "desiredRoofingMaterial" TEXT,
    ADD COLUMN "roofColorSelection" TEXT,
    ADD COLUMN "roofingProjectType" TEXT,
    ADD COLUMN "roofingNotes" TEXT,
    ADD COLUMN "roofrFormUrl" TEXT,
    ADD COLUMN "roofrId" TEXT,
    ADD COLUMN "roofrPropertyInfo" TEXT,
    ADD COLUMN "roofrPropertyType" TEXT,
    ADD COLUMN "roofSlope" TEXT,
    ADD COLUMN "roofrGclid" TEXT;
