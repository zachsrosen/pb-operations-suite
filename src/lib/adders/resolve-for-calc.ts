import { listAdders } from "./catalog";
import { resolveAddersFromList } from "./pricing";
import type { AppliesToContext, ResolvedAdder } from "./types";

/**
 * DB-aware wrapper around `resolveAddersFromList`.
 *
 * Loads all active adders from the catalog and filters them by auto-apply
 * + appliesTo against the given context. Intended for server-side callers
 * that want to supply `options.resolvedAdders` to `calcPrice`.
 *
 * Kept in its own module so `pricing.ts` stays client-safe — importing
 * `./catalog` from `pricing.ts` pulls in the Prisma client and breaks the
 * client bundler when `pricing.ts` is imported from React components
 * (e.g. the Adders dashboard).
 */
export async function resolveAddersForCalc(
  context: { shop: string } & AppliesToContext
): Promise<ResolvedAdder[]> {
  const adders = await listAdders({ active: true });
  return resolveAddersFromList(adders, context);
}
