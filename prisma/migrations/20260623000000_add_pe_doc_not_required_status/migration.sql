-- Add NOT_REQUIRED to PeDocStatus for conditionally-required docs (e.g. Bill of
-- Materials) PE does not request on a given project. Additive enum value.
ALTER TYPE "PeDocStatus" ADD VALUE IF NOT EXISTS 'NOT_REQUIRED';
