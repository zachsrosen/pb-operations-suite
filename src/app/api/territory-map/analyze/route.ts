import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { TERRITORY_BOUNDARIES } from "@/lib/constants";

interface AnalyzeRequest {
  officeStats: {
    name: string;
    count: number;
    totalRevenue: number;
    pct: number;
  }[];
  useProposed: boolean;
  boundaries: { westminster: number; centennial: number };
  totalDeals: number;
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body: AnalyzeRequest = await request.json();
    const { officeStats, useProposed, boundaries, totalDeals } = body;

    const client = getAnthropicClient();

    const statsBlock = officeStats
      .map(
        (o) =>
          `- ${o.name}: ${o.count} deals (${o.pct}%), $${(o.totalRevenue / 1_000_000).toFixed(2)}M revenue`,
      )
      .join("\n");

    const boundaryMode = useProposed ? "PROPOSED" : "CURRENT";
    const currentBounds = TERRITORY_BOUNDARIES.current;
    const proposedBounds = TERRITORY_BOUNDARIES.proposed;

    const prompt = `You are a solar operations analyst for Photon Brothers, a residential solar company with 3 Colorado offices: Westminster (north), Centennial (central/DTC), and Colorado Springs (south).

Ownership's goal is a 2:2:1 deal ratio — Westminster and Centennial should each handle roughly equal volume, with Colorado Springs at ~50% of each.

TERRITORY DATA (${boundaryMode} boundaries):
- Boundary mode: ${boundaryMode}
- Westminster/Centennial line: latitude ${boundaries.westminster}
- Centennial/Colorado Springs line: latitude ${boundaries.centennial}
- Total geocoded deals: ${totalDeals}

Current boundary config: Westminster/Centennial at ${currentBounds.westminster}, Centennial/COSP at ${currentBounds.centennial}
Proposed boundary config: Westminster/Centennial at ${proposedBounds.westminster}, Centennial/COSP at ${proposedBounds.centennial}

PER-OFFICE STATS:
${statsBlock}

Provide a concise analysis covering:

1. **Balance Assessment** — How close is the current distribution to the 2:2:1 target? Quantify the gap.

2. **Boundary Impact** — If viewing current boundaries, explain what the proposed boundaries would change. If viewing proposed, explain the improvement vs current.

3. **Revenue Disparity** — Flag any significant revenue-per-deal differences between offices and what that implies about deal mix or market.

4. **Recommendations** — 2-3 actionable suggestions for ownership. Consider boundary adjustments, staffing rebalancing, or market development.

Keep it direct and data-driven. Use bullet points. No fluff. This is for solar operations leadership.`;

    const response = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const analysis =
      response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("Territory analysis error:", err);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 },
    );
  }
}
