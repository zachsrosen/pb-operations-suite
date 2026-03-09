/**
 * Roof & Shade Summary Card
 *
 * Shows Google Solar API data: max panel count, roof segments,
 * sunshine hours, and imagery quality.
 */

"use client";

interface RoofShadeSummaryProps {
  equipmentConfig: Record<string, unknown> | null;
  siteConditions: Record<string, unknown> | null;
  lat: number | null;
  lng: number | null;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted/60">{sub}</div>}
    </div>
  );
}

export default function RoofShadeSummary({
  equipmentConfig,
  siteConditions,
  lat,
  lng,
}: RoofShadeSummaryProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shadeData = equipmentConfig?.shadeData as any;
  const shadeSource = siteConditions?.shadeSource as string | undefined;

  if (!shadeData && !lat) return null;

  const maxPanels = shadeData?.maxArrayPanelsCount ?? null;
  const maxSunshine = shadeData?.maxSunshineHoursPerYear ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roofSegments = (shadeData?.roofSegments ?? []) as any[];
  const imageryQuality = shadeData?.imageryQuality ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const solarPanels = (shadeData?.solarPanels ?? []) as any[];

  // Compute avg TSRF from solar panels if available
  let avgTsrf: number | null = null;
  if (solarPanels.length > 0 && maxSunshine > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalEnergy = solarPanels.reduce((sum: number, p: any) => sum + (p.yearlyEnergyDcKwh ?? 0), 0);
    // Assume ~440W panels for TSRF derivation
    const refEnergy = solarPanels.length * 0.440 * maxSunshine;
    if (refEnergy > 0) {
      avgTsrf = Math.min(totalEnergy / refEnergy, 1.0);
    }
  }

  return (
    <div className="rounded-lg border border-t-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Roof & Shade Analysis</h3>
        {imageryQuality && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
            imageryQuality === "HIGH"
              ? "bg-green-500/15 text-green-400 border-green-500/30"
              : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
          }`}>
            {imageryQuality} quality imagery
          </span>
        )}
      </div>

      {/* Coordinates */}
      {lat && lng && (
        <div className="text-xs text-muted/60">
          {lat.toFixed(4)}°N, {Math.abs(lng).toFixed(4)}°W
        </div>
      )}

      {/* Key stats */}
      {shadeData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {maxPanels !== null && (
            <Stat label="Max Panels (Google)" value={maxPanels} sub="roof capacity" />
          )}
          {maxSunshine !== null && (
            <Stat label="Max Sunshine" value={`${Math.round(maxSunshine)} hrs/yr`} />
          )}
          {roofSegments.length > 0 && (
            <Stat label="Roof Segments" value={roofSegments.length} />
          )}
          {avgTsrf !== null && (
            <Stat label="Avg TSRF (derived)" value={`${(avgTsrf * 100).toFixed(1)}%`} />
          )}
        </div>
      )}

      {/* Roof segments breakdown */}
      {roofSegments.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted font-medium">Roof Segments</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {roofSegments.slice(0, 6).map((seg, i) => {
              const azimuth = seg.azimuthDegrees ?? seg.stats?.azimuthDegrees;
              const pitch = seg.pitchDegrees ?? seg.stats?.pitchDegrees;
              const area = seg.stats?.areaMeters2;
              const sunshine = seg.stats?.sunshineQuantiles;
              const medianSunshine = sunshine?.[Math.floor(sunshine.length / 2)];

              return (
                <div
                  key={i}
                  className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-zinc-800/50"
                >
                  <span className="text-muted">Segment {i + 1}</span>
                  <span className="text-foreground space-x-2">
                    {azimuth != null && <span>{Math.round(azimuth)}° az</span>}
                    {pitch != null && <span>{Math.round(pitch)}° pitch</span>}
                    {area != null && <span>{Math.round(area)}m²</span>}
                    {medianSunshine != null && <span>{Math.round(medianSunshine)}h sun</span>}
                  </span>
                </div>
              );
            })}
            {roofSegments.length > 6 && (
              <div className="text-[10px] text-muted/50 px-2">
                +{roofSegments.length - 6} more segments
              </div>
            )}
          </div>
        </div>
      )}

      {/* No shade data */}
      {!shadeData && (
        <div className="text-xs text-muted/60">
          {shadeSource === "google_solar"
            ? "Google Solar data unavailable for this location"
            : "No shade analysis configured"}
        </div>
      )}
    </div>
  );
}
