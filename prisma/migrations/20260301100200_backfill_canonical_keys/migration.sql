UPDATE "EquipmentSku"
SET
  "canonicalBrand" = LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')),
  "canonicalModel" = LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g')),
  "canonicalKey" = "category"::text || '|' || LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g'))
WHERE "canonicalKey" IS NULL;
