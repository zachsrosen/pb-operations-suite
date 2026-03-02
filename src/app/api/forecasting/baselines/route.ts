import { NextRequest, NextResponse } from "next/server";
import { getBaselineTable } from "@/lib/forecasting";

export async function GET(_request: NextRequest) {
  try {
    const { data, cached, stale, lastUpdated } = await getBaselineTable();

    // Compute summary stats
    const segmentCount = Object.keys(data).length;
    const globalEntry = data.global;
    const totalSamples = globalEntry?.sampleCount ?? 0;

    return NextResponse.json({
      baselines: data,
      summary: {
        segmentCount,
        totalCompletedProjects: totalSamples,
      },
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Forecast baselines API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forecast baselines" },
      { status: 500 },
    );
  }
}
