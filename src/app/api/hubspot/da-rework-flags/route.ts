import { NextRequest, NextResponse } from "next/server";
import { getDaReworkFlagsBatch, type DaReworkFlags } from "@/lib/da-rework-flags";

const MAX_DEALS_PER_REQUEST = 1000;

type DealInput = {
  dealId: string;
  revisionCounter: number | null;
  approvalDate: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { deals?: DealInput[] };
    const deals = Array.isArray(body.deals) ? body.deals : [];

    if (deals.length === 0) {
      return NextResponse.json({ flags: {} });
    }

    if (deals.length > MAX_DEALS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many deals (max ${MAX_DEALS_PER_REQUEST})` },
        { status: 400 }
      );
    }

    const normalized: DealInput[] = [];
    for (const d of deals) {
      if (!d || typeof d.dealId !== "string" || !d.dealId) continue;
      normalized.push({
        dealId: d.dealId,
        revisionCounter:
          typeof d.revisionCounter === "number" && !isNaN(d.revisionCounter)
            ? d.revisionCounter
            : null,
        approvalDate: typeof d.approvalDate === "string" ? d.approvalDate : null,
      });
    }

    const flags: Record<string, DaReworkFlags> = await getDaReworkFlagsBatch(normalized);
    // TEMP diagnostic — remove once root cause confirmed
    const flagKeys = Object.keys(flags);
    const rejectedCount = flagKeys.filter((k) => flags[k].hadRejection).length;
    console.log(
      `[da-rework-flags] received=${deals.length} normalized=${normalized.length} flagKeys=${flagKeys.length} rejected=${rejectedCount} sampleIn=${normalized.slice(0, 2).map((n) => n.dealId).join(",")} sampleOut=${flagKeys.slice(0, 2).join(",")}`
    );
    return NextResponse.json({ flags });
  } catch (error) {
    console.error("DA rework flags API error:", error);
    return NextResponse.json({ error: "Failed to compute rework flags" }, { status: 500 });
  }
}
