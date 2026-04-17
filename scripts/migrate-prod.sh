#!/usr/bin/env bash
# Guarded wrapper for `prisma migrate deploy` against production.
#
# Why this script exists: a 2026-04-17 incident dropped the User.role column
# on prod when a subagent invoked `npx prisma migrate deploy` directly.
# Deployed code still read that column, causing an 8-minute auth outage.
#
# Usage:
#   scripts/migrate-prod.sh             # dry-run: shows what would apply
#   scripts/migrate-prod.sh CONFIRM     # actually applies
#
# Subagents MUST NOT invoke `prisma migrate deploy` or call this script.
# Only the human operator (orchestrator) runs this, and only after they've
# verified:
#   1. Target branch code is merged + Vercel deploy has rolled out.
#   2. They're prepared to monitor Sentry / auth flow for 30 minutes after.
#   3. Rollback SQL is ready if the migration has irreversible effects.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "Error: .env not found in repo root"
  exit 2
fi

# Load env so we can show which DB we'd hit.
set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL not set in .env"
  exit 2
fi

# Mask password for display.
MASKED_URL=$(echo "$DATABASE_URL" | sed -E 's|(://[^:]+:)[^@]+(@)|\1***\2|')

echo "========================================================"
echo "PRODUCTION MIGRATION — scripts/migrate-prod.sh"
echo "========================================================"
echo
echo "DATABASE_URL: $MASKED_URL"
echo
echo "Pending migrations:"
npx prisma migrate status 2>&1 | tail -20
echo

if [[ "${1:-}" != "CONFIRM" ]]; then
  echo "This was a dry-run. Re-run with 'CONFIRM' as the only argument"
  echo "to apply pending migrations to the target database:"
  echo
  echo "    scripts/migrate-prod.sh CONFIRM"
  echo
  exit 0
fi

echo "========================================================"
echo "APPLYING MIGRATIONS (CONFIRM flag present)"
echo "========================================================"
npx prisma migrate deploy
echo
echo "Done. Verify via:"
echo "    npx prisma migrate status"
echo "and watch Sentry / the app for 30 minutes."
