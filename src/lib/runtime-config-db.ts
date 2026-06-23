/**
 * Prisma binding for the runtime config resolver. App code imports this; the
 * pure precedence/cache logic (and its tests) live in `runtime-config.ts`.
 */
import { prisma } from "@/lib/db";
import { resolveRuntimeConfig } from "@/lib/runtime-config";

/**
 * Resolve a config value from `process.env` (via `envKeys`, in order) or a
 * `SystemConfig` row keyed by `key`. See `runtime-config.ts` for precedence.
 */
export function getRuntimeConfig(
  key: string,
  envKeys: string[] = [],
): Promise<string | undefined> {
  return resolveRuntimeConfig(key, envKeys, async (k) => {
    const row = await prisma.systemConfig.findUnique({ where: { key: k } });
    return row?.value ?? undefined;
  });
}
