"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface Props {
  dealId: string;
  ahjName: string | null;
  utilityName: string | null;
}

interface AHJRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface UtilityRecord {
  id: string;
  properties: Record<string, string | null>;
}

// Key AHJ fields to display in the IDR meeting
const AHJ_DISPLAY_FIELDS: { key: string; label: string }[] = [
  { key: "ibc_code", label: "IBC" },
  { key: "irc_code", label: "IRC" },
  { key: "ifc_code", label: "IFC" },
  { key: "nec_code", label: "NEC" },
  { key: "design_wind_speed", label: "Wind" },
  { key: "design_snow_load", label: "Snow" },
  { key: "fire_offsets_required", label: "Fire Offsets" },
  { key: "stamping_requirements", label: "Stamping" },
  { key: "is_rsd_required_", label: "RSD Req" },
  { key: "submission_method", label: "Submission" },
];

// Key Utility fields to display
const UTILITY_DISPLAY_FIELDS: { key: string; label: string }[] = [
  { key: "ac_disconnect_required_", label: "AC Disco" },
  { key: "backup_switch_allowed_", label: "Backup SW" },
  { key: "is_production_meter_required_", label: "Prod Meter" },
  { key: "system_size_rule", label: "Size Rule" },
  { key: "interconnection_required", label: "IC Req" },
  { key: "submission_type", label: "Submission" },
];

export function AhjUtilityInfo({ dealId, ahjName, utilityName }: Props) {
  const ahjQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "ahj", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/ahj?dealId=${dealId}`);
      if (!res.ok) return { ahjs: [] as AHJRecord[] };
      return res.json() as Promise<{ ahjs: AHJRecord[] }>;
    },
    enabled: !!dealId,
    staleTime: 10 * 60 * 1000, // 10 min — codes don't change often
  });

  const utilityQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "utility", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/utility?dealId=${dealId}`);
      if (!res.ok) return { utilities: [] as UtilityRecord[] };
      return res.json() as Promise<{ utilities: UtilityRecord[] }>;
    },
    enabled: !!dealId,
    staleTime: 10 * 60 * 1000,
  });

  const ahj = ahjQuery.data?.ahjs?.[0];
  const utility = utilityQuery.data?.utilities?.[0];
  const loading = ahjQuery.isLoading || utilityQuery.isLoading;

  if (loading) {
    return <div className="h-8 w-full rounded bg-surface-2 animate-pulse" />;
  }

  if (!ahj && !utility) {
    return (
      <p className="text-xs text-muted">
        No AHJ{ahjName ? ` (${ahjName})` : ""} or utility{utilityName ? ` (${utilityName})` : ""} linked to this deal.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* AHJ Codes */}
      {ahj && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            AHJ: {ahj.properties.record_name ?? ahjName ?? "Unknown"}
          </p>
          <div className="flex flex-wrap gap-1">
            {AHJ_DISPLAY_FIELDS.map(({ key, label }) => {
              const val = ahj.properties[key];
              if (!val) return null;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px]"
                  title={`${label}: ${val}`}
                >
                  <span className="font-semibold text-muted">{label}</span>
                  <span className="text-foreground">{formatVal(val)}</span>
                </span>
              );
            })}
          </div>
          {ahj.properties.building_code_notes && (
            <p className="text-[10px] text-muted mt-1">
              <span className="font-medium">Notes:</span> {ahj.properties.building_code_notes}
            </p>
          )}
        </div>
      )}

      {/* Utility Requirements */}
      {utility && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            Utility: {utility.properties.record_name ?? utility.properties.utility_company_name ?? utilityName ?? "Unknown"}
          </p>
          <div className="flex flex-wrap gap-1">
            {UTILITY_DISPLAY_FIELDS.map(({ key, label }) => {
              const val = utility.properties[key];
              if (!val) return null;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px]"
                  title={`${label}: ${val}`}
                >
                  <span className="font-semibold text-muted">{label}</span>
                  <span className="text-foreground">{formatVal(val)}</span>
                </span>
              );
            })}
          </div>
          {utility.properties.design_notes && (
            <p className="text-[10px] text-muted mt-1">
              <span className="font-medium">Notes:</span> {utility.properties.design_notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Shorten boolean-like values and long strings for compact display. */
function formatVal(val: string): string {
  const lower = val.toLowerCase();
  if (lower === "true" || lower === "yes") return "Yes";
  if (lower === "false" || lower === "no") return "No";
  // Truncate long values
  return val.length > 30 ? val.slice(0, 28) + "..." : val;
}
