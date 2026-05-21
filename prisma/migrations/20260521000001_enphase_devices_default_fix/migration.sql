-- Fix devices column default from '[]' to '{}' (object shape, not array)
ALTER TABLE "EnphaseSite" ALTER COLUMN "devices" SET DEFAULT '{}';
