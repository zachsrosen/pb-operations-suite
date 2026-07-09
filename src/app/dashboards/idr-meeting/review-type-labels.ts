// Pure, client-safe: no Prisma/server imports. Pipeline IDs are stable
// HubSpot IDs; the server registry uses the same values as env fallbacks.
export const SERVICE_PIPELINE_ID = "23928924";
export const DNR_PIPELINE_ID = "21997330";

/** Compact display label for an item type pill/badge. */
export function reviewTypePillLabel(
  type: string,
  pipeline: string | null | undefined,
): string {
  if (type === "DNR_SERVICE") {
    if (pipeline === SERVICE_PIPELINE_ID) return "SVC";
    if (pipeline === DNR_PIPELINE_ID) return "D&R";
    return "D&R/SVC";
  }
  if (type === "NEW_CONSTRUCTION") return "NC";
  return type;
}
