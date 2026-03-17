/**
 * @deprecated Use /api/inventory/products/[id]/sync instead.
 * Compatibility wrapper — will be removed after one release cycle.
 */
export { GET, POST } from "@/app/api/inventory/products/[id]/sync/route";
export const runtime = "nodejs";
export const maxDuration = 60;
