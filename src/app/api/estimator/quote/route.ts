import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  QuoteRequestSchema,
  runEstimator,
  loadUtilityById,
  loadPricing,
  FALLBACK_PANEL_WATTAGE,
} from "@/lib/estimator";
import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";

export async function POST(request: Request) {
  const ipHash = hashIp(extractIp(request));
  const allowed = await checkRateLimit(rateLimitKey("quote", ipHash), 30, 60_000);
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = QuoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const q = parsed.data;

  const utility = loadUtilityById(q.utilityId);
  if (!utility) {
    return NextResponse.json({ error: "Unknown utility" }, { status: 400 });
  }

  const basePricing = loadPricing();
  // Let InternalProduct.defaultForEstimator override panelOutput at runtime
  // so catalog changes flow through without a code deploy.
  const panelOutput = await resolveDefaultPanelWattage(basePricing.panelOutput);
  const pricing = { ...basePricing, panelOutput };

  const result = runEstimator({
    quoteType: "new_install",
    address: q.address,
    location: q.location,
    utility,
    usage: q.usage,
    home: q.home,
    considerations: q.considerations,
    addOns: q.addOns,
    pricing,
  });

  return NextResponse.json({ result });
}

async function resolveDefaultPanelWattage(configDefault: number): Promise<number> {
  try {
    const found = await prisma.internalProduct.findFirst({
      where: { category: "MODULE", defaultForEstimator: true, isActive: true },
      include: { moduleSpec: true },
    });
    const watt = found?.moduleSpec?.wattage ?? found?.unitSpec;
    if (typeof watt === "number" && watt >= 300 && watt <= 800) return watt;
  } catch (err) {
    console.warn("[estimator] default panel lookup failed", err);
  }
  return configDefault || FALLBACK_PANEL_WATTAGE;
}
