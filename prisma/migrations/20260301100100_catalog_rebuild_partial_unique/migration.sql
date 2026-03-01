CREATE UNIQUE INDEX "PendingCatalogPush_canonicalKey_pending_unique"
  ON "PendingCatalogPush" ("canonicalKey")
  WHERE "status" = 'PENDING' AND "canonicalKey" IS NOT NULL;
