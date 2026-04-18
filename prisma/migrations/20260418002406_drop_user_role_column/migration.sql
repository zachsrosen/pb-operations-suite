-- Option E: drop the legacy `User.role` single-role column.
--
-- After Phase 1 (multi-role array), Phase 2 (shim removal), and the bake
-- period through Option B + D, nothing in the product code reads
-- `dbUser.role` anymore. This removes the dead column and its index.
--
-- Pre-flight verification (done before shipping this PR):
--   rg '\buser\.role\b' src/ --type ts --glob '!src/__tests__/**' \
--      --glob '!src/generated/**' --glob '!src/lib/role-permissions.ts'
--   → 0 hits
--
-- Rollback: re-add the column as nullable via a follow-up migration. The
-- legacy data is lost; this is one-way unless captured in a snapshot before.
-- A Neon branch is recommended as the rollback point (cheap, fast, easy).
--
-- Idempotent: `DROP ... IF EXISTS` so re-runs are safe.

DROP INDEX IF EXISTS "User_role_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
