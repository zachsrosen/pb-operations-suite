function readSecret(env: NodeJS.ProcessEnv): string {
  const canaryToken = (env.SENTRY_CANARY_TOKEN || "").trim();
  if (canaryToken) {
    return canaryToken;
  }
  return (env.CRON_SECRET || "").trim();
}

export function isSentryCanaryAuthorized(
  authHeader: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = readSecret(env);
  if (!secret) {
    return env.NODE_ENV !== "production";
  }
  return authHeader === `Bearer ${secret}`;
}
