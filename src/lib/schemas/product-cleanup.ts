import { z } from "zod";
import { CLEANUP_SOURCES, type CleanupSource } from "@/lib/product-cleanup-adapters";

export const PRODUCT_CLEANUP_MAX_BATCH = 50;
export const PRODUCT_CLEANUP_CONFIRM_TTL_MS = 5 * 60 * 1000;

const cleanupSourceEnum = z.enum(CLEANUP_SOURCES);

export const productCleanupActionsSchema = z.object({
  internal: z.enum(["none", "deactivate"]),
  links: z.enum(["none", "unlink_selected"]),
  external: z.enum(["none", "delete_selected"]),
  sources: z
    .array(cleanupSourceEnum)
    .max(CLEANUP_SOURCES.length)
    .transform((values) => {
      const unique = [...new Set(values)];
      const order = new Map(CLEANUP_SOURCES.map((source, index) => [source, index]));
      return unique.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    }),
  deleteCachedProducts: z.boolean().optional(),
});

export const productCleanupRequestSchema = z
  .object({
    internalSkuIds: z.array(z.string().trim().min(1)).min(1).max(PRODUCT_CLEANUP_MAX_BATCH),
    actions: productCleanupActionsSchema,
    dryRun: z.boolean().optional().default(false),
    confirmation: z.object({
      token: z.string().trim().min(1),
      issuedAt: z.number().finite(),
    }),
  })
  .superRefine((value, ctx) => {
    const uniqueSkuIds = new Set(value.internalSkuIds.map((id) => id.trim()));
    if (uniqueSkuIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalSkuIds"],
        message: "At least one internal product ID is required.",
      });
      return;
    }
    if (uniqueSkuIds.size > PRODUCT_CLEANUP_MAX_BATCH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalSkuIds"],
        message: `A maximum of ${PRODUCT_CLEANUP_MAX_BATCH} unique SKU IDs is allowed per request.`,
      });
    }
    if (value.actions.external === "delete_selected" && value.actions.sources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", "sources"],
        message: "Select at least one source when external cleanup is enabled.",
      });
    }
  });

export type ProductCleanupRequest = z.infer<typeof productCleanupRequestSchema>;

export function dedupeSkuIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function toSourceRecord<T>(
  sources: CleanupSource[],
  initializer: (source: CleanupSource) => T
): Record<CleanupSource, T> {
  return sources.reduce<Record<CleanupSource, T>>((acc, source) => {
    acc[source] = initializer(source);
    return acc;
  }, {} as Record<CleanupSource, T>);
}

