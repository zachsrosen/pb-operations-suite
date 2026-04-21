import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  QuoteRequestSchema,
  runEstimator,
  loadUtilityById,
  loadKwhPerKwYear,
  loadPricePerWatt,
  loadAddOnPricing,
  loadFinancingDefaults,
  loadApplicableIncentives,
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
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const q = parsed.data;

  const utility = loadUtilityById(q.utilityId);
  if (!utility) {
    return NextResponse.json({ error: "Unknown utility" }, { status: 400 });
  }

  // Resolve panel wattage from InternalProduct flag (fallback to constant).
  const panelWattage = await resolveDefaultPanelWattage();
  const pricePerWatt = loadPricePerWatt(q.location);
  const kWhPerKwYear = loadKwhPerKwYear(q.address.state, q.home.shade);
  const addOnPricing = loadAddOnPricing();
  const financing = loadFinancingDefaults();
  const incentives = loadApplicableIncentives({
    state: q.address.state,
    zip: q.address.zip,
    utilityId: utility.id,
  });

  const result = runEstimator({
    quoteType: "new_install",
    address: q.address,
    location: q.location,
    utility: { id: utility.id, avgBlendedRateUsdPerKwh: utility.avgBlendedRateUsdPerKwh },
    usage: q.usage,
    home: q.home,
    considerations: q.considerations,
    addOns: q.addOns,
    panelWattage,
    pricePerWatt,
    kWhPerKwYear,
    incentives,
    addOnPricing,
    financing,
  });

  return NextResponse.json({ result });
}

async function resolveDefaultPanelWattage(): Promise<number> {
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
  return FALLBACK_PANEL_WATTAGE;
}
