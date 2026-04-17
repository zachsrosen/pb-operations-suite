-- Add SERVICE role to UserRole enum.
-- Grants Service Suite access (tickets, priority queue, service scheduler, customer history)
-- without the broader Operations Suite, Accounting Suite, or Intelligence visibility.
-- See src/lib/role-permissions.ts (SERVICE entry) and src/lib/suite-nav.ts for scope.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SERVICE';
