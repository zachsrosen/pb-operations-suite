-- Tesla added the "ReturnMerchandiseAuthorization" alert severity; store it
-- first-class instead of coercing to INFORMATIONAL.
ALTER TYPE "PowerhubAlertSeverity" ADD VALUE IF NOT EXISTS 'RMA';
