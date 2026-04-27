/**
 * Shit Show — HubSpot deal property read/write
 *
 * The shit-show flag lives on the HubSpot Deal object, not in our DB.
 * Three custom properties:
 *   - pb_shit_show_flagged       (Single checkbox)
 *   - pb_shit_show_reason        (Multi-line text)
 *   - pb_shit_show_flagged_since (Date)
 *
 * The IDR meeting hub's existing 🔥 toggle and the Shit Show meeting hub
 * both call setShitShowFlag() to mutate these.
 */

import { updateDealProperty, getDealProperties } from "@/lib/hubspot";

export const SHIT_SHOW_PROPS = {
  FLAGGED: "pb_shit_show_flagged",
  REASON: "pb_shit_show_reason",
  FLAGGED_SINCE: "pb_shit_show_flagged_since",
} as const;

export type ShitShowFlagState = {
  flagged: boolean;
  reason: string | null;
  flaggedSince: Date | null;
};

/**
 * Read the current shit-show flag state for a deal.
 */
export async function readShitShowFlag(dealId: string): Promise<ShitShowFlagState> {
  const props = await getDealProperties(dealId, [
    SHIT_SHOW_PROPS.FLAGGED,
    SHIT_SHOW_PROPS.REASON,
    SHIT_SHOW_PROPS.FLAGGED_SINCE,
  ]);
  return {
    flagged: props?.[SHIT_SHOW_PROPS.FLAGGED] === "true",
    reason: (props?.[SHIT_SHOW_PROPS.REASON] as string) || null,
    flaggedSince: props?.[SHIT_SHOW_PROPS.FLAGGED_SINCE]
      ? new Date(props[SHIT_SHOW_PROPS.FLAGGED_SINCE] as string)
      : null,
  };
}

/**
 * Set or clear the shit-show flag on a deal.
 *
 * - flagged=true on a previously-unflagged deal: sets all 3 props (flagged_since=today).
 * - flagged=true on an already-flagged deal: only updates reason (preserves flagged_since).
 * - flagged=false: clears all 3 props.
 *
 * Idempotent — safe to call repeatedly.
 */
export async function setShitShowFlag(
  dealId: string,
  flagged: boolean,
  reason?: string,
): Promise<void> {
  if (!flagged) {
    await updateDealProperty(dealId, {
      [SHIT_SHOW_PROPS.FLAGGED]: "false",
      [SHIT_SHOW_PROPS.REASON]: "",
      [SHIT_SHOW_PROPS.FLAGGED_SINCE]: "",
    });
    return;
  }

  // flagged=true: read current state to decide whether to stamp flagged_since.
  const current = await readShitShowFlag(dealId);
  const properties: Record<string, string> = {
    [SHIT_SHOW_PROPS.FLAGGED]: "true",
    [SHIT_SHOW_PROPS.REASON]: reason ?? "",
  };
  if (!current.flagged) {
    properties[SHIT_SHOW_PROPS.FLAGGED_SINCE] = new Date().toISOString().slice(0, 10);
  }
  await updateDealProperty(dealId, properties);
}
