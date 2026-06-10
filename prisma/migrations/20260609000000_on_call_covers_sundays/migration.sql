-- On-call Sunday coverage toggle. When false, the pool's weekly assignee covers
-- Mon-Sat only and no assignment row is generated for Sundays (California
-- dropped Sunday on-call in 2026-06). Existing pools default to true (cover all
-- 7 days) so behavior is unchanged until an admin opts a pool out.

ALTER TABLE "OnCallPool"
  ADD COLUMN IF NOT EXISTS "coversSundays" BOOLEAN NOT NULL DEFAULT true;
