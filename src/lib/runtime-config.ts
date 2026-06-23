/**
 * Runtime config resolver.
 *
 * Resolves a config value with this precedence:
 *   1. a `process.env` var (instant, no DB) — checked in `envKeys` order
 *   2. a `SystemConfig` DB row (cached in-memory for 60s)
 *
 * Why: Vercel caps the *total* size of a project's env vars (~64KB) and we hit
 * it. Server-only config that isn't needed in edge middleware, at build time, or
 * to bootstrap the DB can live in a `SystemConfig` row instead, freeing env
 * headroom and allowing live changes (no redeploy). The env var still wins when
 * present, so anything already in Vercel keeps working and a DB row is a drop-in
 * alternative or override.
 *
 * The DB read is INJECTED (`fetchDbValue`) so this module stays prisma-free and
 * unit-testable — importing `@/lib/db` into a Jest test drags in the generated
 * Prisma client, which Jest can't parse. App code calls `getRuntimeConfig` from
 * `runtime-config-db.ts`, which wires in the real Prisma read.
 */

const TTL_MS = 60_000;

interface CacheEntry {
  value: string | undefined;
  at: number;
}

const cache = new Map<string, CacheEntry>();

export async function resolveRuntimeConfig(
  key: string,
  envKeys: string[],
  fetchDbValue: (key: string) => Promise<string | undefined>,
  now: number = Date.now(),
): Promise<string | undefined> {
  // 1. env wins — instant, and keeps existing Vercel vars authoritative.
  for (const envKey of envKeys) {
    const v = process.env[envKey];
    if (v) return v;
  }

  // 2. cached DB value, if fresh.
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) return cached.value;

  // 3. read the DB row; on failure serve the last known value rather than throw.
  let value: string | undefined;
  try {
    value = await fetchDbValue(key);
  } catch {
    return cached?.value;
  }
  cache.set(key, { value, at: now });
  return value;
}

/** Test helper — drop all cached DB lookups. */
export function clearRuntimeConfigCache(): void {
  cache.clear();
}
