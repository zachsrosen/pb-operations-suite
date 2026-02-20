function normalizeDsn(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Prefer a server-only DSN, then fall back to the public DSN.
 * This keeps server/edge monitoring active in deployments that only define one variable.
 */
export function resolveSentryDsn(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return normalizeDsn(env.SENTRY_DSN) ?? normalizeDsn(env.NEXT_PUBLIC_SENTRY_DSN);
}
