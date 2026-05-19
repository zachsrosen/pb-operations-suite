import { PowerhubLink } from "./PowerhubLink";

export interface SystemHealthBadgeProps {
  portalUrl: string | null | undefined;
  activeAlertCount: number;
  highestSeverity?: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL" | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "bg-red-500",
  PERFORMANCE: "bg-yellow-500",
  INFORMATIONAL: "bg-blue-500",
};

/**
 * Compact badge for table rows.
 * Shows: severity dot (when alerts active) + clickable external-link icon.
 * Returns null when there is no portalUrl AND no alerts.
 */
export function SystemHealthBadge({
  portalUrl,
  activeAlertCount,
  highestSeverity,
}: SystemHealthBadgeProps) {
  if (!portalUrl && activeAlertCount === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      {activeAlertCount > 0 && highestSeverity && (
        <span
          title={`${activeAlertCount} active ${highestSeverity.toLowerCase()} alert${activeAlertCount === 1 ? "" : "s"}`}
          className={`inline-block h-2 w-2 rounded-full ${SEVERITY_COLOR[highestSeverity]}`}
        />
      )}
      <PowerhubLink url={portalUrl ?? null} variant="icon" />
    </div>
  );
}
