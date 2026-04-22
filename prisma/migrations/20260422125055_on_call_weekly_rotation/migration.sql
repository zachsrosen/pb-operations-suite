-- On-call weekly rotation support.
-- Spec: 2026-04-22 weekly rotation + self-service swaps + merged Colorado pool.
--
-- Schema-level change only: adds rotationUnit column. The pool merge + data
-- reseed (for the May trial period) runs via scripts/reseed-on-call-for-trial.ts
-- after this migration is applied.

ALTER TABLE "OnCallPool"
  ADD COLUMN IF NOT EXISTS "rotationUnit" TEXT NOT NULL DEFAULT 'weekly';
