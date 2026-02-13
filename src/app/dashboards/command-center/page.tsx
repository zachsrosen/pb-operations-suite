import { redirect } from "next/navigation";

/**
 * Command Center has been split into individual executive dashboards:
 * - /dashboards/pipeline (Pipeline Overview)
 * - /dashboards/revenue (Revenue)
 * - /dashboards/capacity (Capacity Planning)
 * - /dashboards/pe (Participate Energy)
 * - /dashboards/alerts (Alerts)
 * - /dashboards/executive (Executive Summary)
 * - /dashboards/locations (Location Comparison)
 *
 * Redirect to the Executive Suite hub which links to all of them.
 */
export default function CommandCenterPage() {
  redirect("/suites/executive");
}
