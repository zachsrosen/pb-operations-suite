/**
 * HubSpot Status Display Labels
 *
 * HubSpot custom enum properties (design_status, layout_status,
 * permitting_status, etc.) store human-readable internal values, but the
 * HubSpot portal UI often shows different display labels. This module maps
 * raw stored values → portal-facing labels so our UI matches what users see
 * in HubSpot.
 *
 * Example: `design_status = "Initial Review"` displays as "Ready For Review"
 * in HubSpot. Internal use (filters, writes, comparisons) must keep the raw
 * value — only apply this translation for UI display.
 */

import {
  getPermitStatusDisplayName,
  getICStatusDisplayName,
  getPTOStatusDisplayName,
} from "@/lib/pi-statuses";

const LAYOUT_STATUS_DISPLAY: Record<string, string> = {
  Ready: "Review In Progress",
  "Revision Returned From Design": "DA Revision Ready To Send",
  "Sent to Customer": "Sent For Approval",
};

const DESIGN_STATUS_DISPLAY: Record<string, string> = {
  "Initial Review": "Initial Design Review",
  "Ready for Review": "Final Review/Stamping",
  "DA Approved": "Final Design Review",
  "Revision Final Review": "Revision Final Review/Stamping",
  "Revision Needed - Rejected": "Revision Needed - As-Built",
  "In Revision": "Revision In Progress",
};

/**
 * Translate a raw HubSpot enum value to its portal display label.
 *
 * @param rawStatus - value stored in HubSpot (what the API returns)
 * @param statusProperty - property name (`design_status`, `layout_status`, etc.)
 * @returns the display label shown in the HubSpot portal, or the raw value
 *   when no translation exists
 */
export function getStatusDisplayName(
  rawStatus: string | null | undefined,
  statusProperty: string,
): string {
  if (!rawStatus) return "";
  switch (statusProperty) {
    case "permitting_status":
      return getPermitStatusDisplayName(rawStatus);
    case "interconnection_status":
      return getICStatusDisplayName(rawStatus);
    case "pto_status":
      return getPTOStatusDisplayName(rawStatus);
    case "layout_status":
      return LAYOUT_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    case "design_status":
      return DESIGN_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    default:
      return rawStatus;
  }
}

/** Nullable-safe variant: returns null when input is null/empty. */
export function getStatusDisplayNameOrNull(
  rawStatus: string | null | undefined,
  statusProperty: string,
): string | null {
  if (!rawStatus) return null;
  return getStatusDisplayName(rawStatus, statusProperty);
}
