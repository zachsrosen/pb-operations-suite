const REQUIRED_ENV_IN_PRODUCTION = [
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAIL_DOMAIN",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_IN_PRODUCTION)[number];

function getValue(key: RequiredEnvKey): string | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getMissingProductionEnv(): RequiredEnvKey[] {
  return REQUIRED_ENV_IN_PRODUCTION.filter((key) => !getValue(key));
}

export function assertProductionEnvConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing = getMissingProductionEnv();
  if (missing.length === 0) return;

  throw new Error(
    `Missing required production environment variables: ${missing.join(", ")}`
  );
}

