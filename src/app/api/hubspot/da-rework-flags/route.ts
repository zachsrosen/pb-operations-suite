import { NextRequest, NextResponse } from "next/server";
import { getDaReworkFlagsBatch, type DaReworkFlags } from "@/lib/da-rework-flags";

const MAX_DEALS_PER_REQUEST = 1000;

type DealInputRaw = {
  dealId: string | number;
  revisionCounter?: number | null;
  approvalDate?: string | null;
};

type NormalizedDealInput = {
  dealId: string;
  revisionCounter: number | null;
  approvalDate: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { deals?: DealInputRaw[] };
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

    const normalized: NormalizedDealInput[] = [];
    for (const d of deals) {
      if (!d) continue;
      // Accept both string and number dealIds — Project.id is a number
      // server-side but JSON serializes it as a number. Normalize to string.
      let dealId: string | null = null;
      if (typeof d.dealId === "string" && d.dealId) dealId = d.dealId;
      else if (typeof d.dealId === "number" && Number.isFinite(d.dealId)) dealId = String(d.dealId);
      if (!dealId) continue;
      normalized.push({
        dealId,
        revisionCounter:
          typeof d.revisionCounter === "number" && !isNaN(d.revisionCounter)
            ? d.revisionCounter
            : null,
        approvalDate: typeof d.approvalDate === "string" ? d.approvalDate : null,
      });
    }

    const flags: Record<string, DaReworkFlags> = await getDaReworkFlagsBatch(normalized);
    return NextResponse.json({ flags });
  } catch (error) {
    console.error("DA rework flags API error:", error);
    return NextResponse.json({ error: "Failed to compute rework flags" }, { status: 500 });
  }
}
