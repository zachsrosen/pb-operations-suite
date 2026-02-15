/**
 * Inventory Needs Report API
 *
 * GET /api/inventory/needs
 *   Computes stage-weighted demand vs supply gap for all equipment categories.
 *
 *   Query params:
 *     - weights (JSON string) — optional custom stage weights override
 *
 *   Returns { needs, summary, stageWeights, lastUpdated, projectsAnalyzed }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAllProjects, filterProjectsForContext } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// ── Default stage weights ────────────────────────────────────────────
// Higher weight = more certainty the project will need the equipment soon.
const DEFAULT_STAGE_WEIGHTS: Record<string, number> = {
  "Construction": 1.0,
  "Ready To Build": 1.0,
  "RTB - Blocked": 0.8,
  "Permitting & Interconnection": 0.8,
  "Design & Engineering": 0.5,
  "Site Survey": 0.25,
  "Inspection": 0.5,
  "Permission To Operate": 0.1,
  "Close Out": 0.0,
};

// ── Demand entry shape ───────────────────────────────────────────────
interface DemandEntry {
  brand: string;
  model: string;
  category: string;
  unitSpec: number | null;
  unitLabel: string | null;
  location: string;
  rawDemand: number;
  weightedDemand: number;
  projectCount: number;
}

// ── Need entry (demand + supply merged) ──────────────────────────────
interface NeedEntry extends DemandEntry {
  onHand: number;
  gap: number;
  suggestedOrder: number;
}

export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // ── 1. Parse optional custom weights ───────────────────────────
    const { searchParams } = request.nextUrl;
    const weightsParam = searchParams.get("weights");

    let stageWeights = { ...DEFAULT_STAGE_WEIGHTS };
    if (weightsParam) {
      try {
        const parsed = JSON.parse(weightsParam);
        if (typeof parsed === "object" && parsed !== null) {
          stageWeights = { ...stageWeights, ...parsed };
        }
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON in weights parameter" },
          { status: 400 }
        );
      }
    }

    // ── 2. Fetch projects (cached, active only, equipment context) ─
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: true }),
      false
    );

    const projects = filterProjectsForContext(allProjects || [], "equipment");

    // ── 3. Build demand map ────────────────────────────────────────
    // Key: "CATEGORY:brand:model:location"
    const demandMap = new Map<string, DemandEntry>();

    function accumulateDemand(
      category: string,
      brand: string,
      model: string,
      unitSpec: number | null,
      unitLabel: string | null,
      location: string,
      count: number,
      weight: number
    ) {
      const key = `${category}:${brand}:${model}:${location}`;
      const existing = demandMap.get(key);
      if (existing) {
        existing.rawDemand += count;
        existing.weightedDemand += Math.round(count * weight);
        existing.projectCount += 1;
      } else {
        demandMap.set(key, {
          brand,
          model,
          category,
          unitSpec,
          unitLabel,
          location,
          rawDemand: count,
          weightedDemand: Math.round(count * weight),
          projectCount: 1,
        });
      }
    }

    for (const project of projects) {
      const location = project.pbLocation || "Unknown";
      const stage = project.stage || "Unknown";
      const weight = stageWeights[stage] ?? 0.5;
      const eq = project.equipment;

      // Modules
      if (eq.modules.brand && eq.modules.model && eq.modules.count > 0) {
        accumulateDemand(
          "MODULE",
          eq.modules.brand,
          eq.modules.model,
          eq.modules.wattage || null,
          eq.modules.wattage ? "W" : null,
          location,
          eq.modules.count,
          weight
        );
      }

      // Inverters
      if (eq.inverter.brand && eq.inverter.model && eq.inverter.count > 0) {
        accumulateDemand(
          "INVERTER",
          eq.inverter.brand,
          eq.inverter.model,
          eq.inverter.sizeKwac || null,
          eq.inverter.sizeKwac ? "kW AC" : null,
          location,
          eq.inverter.count,
          weight
        );
      }

      // Batteries (include expansion count)
      if (eq.battery.brand && eq.battery.model && eq.battery.count > 0) {
        const totalBatteries = eq.battery.count + (eq.battery.expansionCount || 0);
        accumulateDemand(
          "BATTERY",
          eq.battery.brand,
          eq.battery.model,
          eq.battery.sizeKwh || null,
          eq.battery.sizeKwh ? "kWh" : null,
          location,
          totalBatteries,
          weight
        );
      }

      // EV Chargers
      if (eq.evCount > 0) {
        accumulateDemand(
          "EV_CHARGER",
          "Generic",
          "EV Charger",
          null,
          null,
          location,
          eq.evCount,
          weight
        );
      }
    }

    // ── 4. Fetch stock levels from DB ──────────────────────────────
    const stockRows = await prisma.inventoryStock.findMany({
      include: { sku: true },
    });

    // Build stock map keyed on "CATEGORY:brand:model:location"
    const stockMap = new Map<string, number>();
    for (const row of stockRows) {
      const key = `${row.sku.category}:${row.sku.brand}:${row.sku.model}:${row.location}`;
      stockMap.set(key, (stockMap.get(key) || 0) + row.quantityOnHand);
    }

    // ── 5. Merge demand + supply into needs list ───────────────────
    const needs: NeedEntry[] = [];

    for (const [key, demand] of demandMap.entries()) {
      const onHand = stockMap.get(key) || 0;
      const gap = demand.weightedDemand - onHand;
      needs.push({
        ...demand,
        onHand,
        gap,
        suggestedOrder: Math.max(0, gap),
      });
    }

    // Sort: category ascending, then gap descending (biggest shortfalls first)
    needs.sort((a, b) => {
      const catCmp = a.category.localeCompare(b.category);
      if (catCmp !== 0) return catCmp;
      return b.gap - a.gap;
    });

    // ── 6. Compute summary ─────────────────────────────────────────
    const uniqueSkus = new Set<string>();
    let totalShortfalls = 0;
    let totalSurplus = 0;
    let totalBalanced = 0;

    for (const entry of needs) {
      uniqueSkus.add(`${entry.category}:${entry.brand}:${entry.model}`);
      if (entry.gap > 0) totalShortfalls++;
      else if (entry.gap < 0) totalSurplus++;
      else totalBalanced++;
    }

    const summary = {
      totalSkus: uniqueSkus.size,
      totalShortfalls,
      totalSurplus,
      totalBalanced,
    };

    // ── 7. Return response ─────────────────────────────────────────
    return NextResponse.json({
      needs,
      summary,
      stageWeights,
      lastUpdated: new Date().toISOString(),
      projectsAnalyzed: projects.length,
    });
  } catch (error) {
    console.error("Failed to compute inventory needs:", error);
    return NextResponse.json(
      { error: "Failed to compute inventory needs" },
      { status: 500 }
    );
  }
}
