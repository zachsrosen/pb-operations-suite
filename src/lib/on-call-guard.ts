import { NextResponse } from "next/server";
import { isOnCallRotationsEnabled } from "./feature-flags";

/**
 * Returns a 503 response when the on-call feature is disabled, or null when enabled.
 * Every /api/on-call/* handler should call this at the top:
 *
 *   const gate = assertOnCallEnabled();
 *   if (gate) return gate;
 */
export function assertOnCallEnabled(): NextResponse | null {
  if (!isOnCallRotationsEnabled()) {
    return NextResponse.json(
      { error: "On-call rotations feature is disabled" },
      { status: 503 },
    );
  }
  return null;
}
