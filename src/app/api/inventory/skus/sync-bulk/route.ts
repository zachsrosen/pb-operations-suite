/**
 * @deprecated Use /api/inventory/products/sync-bulk instead.
 * Compatibility wrapper — will be removed after one release cycle.
 */
export { POST } from "@/app/api/inventory/products/sync-bulk/route";
export const runtime = "nodejs";
export const maxDuration = 120;
