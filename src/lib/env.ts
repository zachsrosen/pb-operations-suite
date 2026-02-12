const REQUIRED_ENV_IN_PRODUCTION = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_IN_PRODUCTION)[number];

function getValue(key: string): string | undefined {
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

  const missing: string[] = [...getMissingProductionEnv()];
  const hasAuthSecret = !!(getValue("NEXTAUTH_SECRET") || getValue("AUTH_SECRET"));
  if (!hasAuthSecret) {
    missing.push("NEXTAUTH_SECRET or AUTH_SECRET");
  }

  if (missing.length === 0) return;

  const formattedMissing = [...new Set(missing)];

  throw new Error(
    `Missing required production environment variables: ${formattedMissing.join(", ")}`
  );
}
