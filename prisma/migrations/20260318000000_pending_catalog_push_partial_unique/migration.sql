-- Partial unique index: only one PENDING request per canonicalKey at a time.
-- Prevents duplicate PendingCatalogPush rows when concurrent BOM pushes
-- both miss the findFirst check before either creates.
CREATE UNIQUE INDEX "PendingCatalogPush_canonicalKey_pending_unique"
  ON "PendingCatalogPush" ("canonicalKey")
  WHERE "status" = 'PENDING';
