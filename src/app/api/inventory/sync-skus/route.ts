/**
 * Inventory SKU Sync API
 *
 * POST /api/inventory/sync-skus
 *   Scans all equipment-context HubSpot projects and upserts unique SKUs
 *   into the EquipmentSku table. Returns counts of created/existing/total.
 *   Auth required, roles: ADMIN, OWNER, MANAGER, PROJECT_MANAGER
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { fetchAllProjects, filterProjectsForContext } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { EquipmentCategory } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER"];

interface SkuTuple {
  category: EquipmentCategory;
  brand: string;
  model: string;
  unitSpec: number | null;
  unitLabel: string | null;
}

export async function POST(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Role check
  if (!ALLOWED_ROLES.includes(authResult.role)) {
    return NextResponse.json(
      {
        error:
          "Insufficient permissions. Requires ADMIN, OWNER, MANAGER, or PROJECT_MANAGER role.",
      },
      { status: 403 }
    );
  }

  try {
    // Fetch all active projects (from cache when possible)
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: true }),
      false
    );

    // Filter down to projects with equipment data
    const equipmentProjects = filterProjectsForContext(
      allProjects || [],
      "equipment"
    );

    // Build a Map of unique SKU tuples keyed on "CATEGORY:brand_lower:model_lower"
    const skuMap = new Map<string, SkuTuple>();

    for (const project of equipmentProjects) {
      const eq = project.equipment;

      // Modules
      const moduleBrand = eq.modules.brand?.trim() || "";
      const moduleModel = eq.modules.model?.trim() || "";
      if (moduleBrand && moduleModel && eq.modules.count > 0) {
        const key = `MODULE:${moduleBrand.toLowerCase()}:${moduleModel.toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "MODULE",
            brand: moduleBrand,
            model: moduleModel,
            unitSpec: eq.modules.wattage || null,
            unitLabel: "W",
          });
        }
      }

      // Inverters
      const inverterBrand = eq.inverter.brand?.trim() || "";
      const inverterModel = eq.inverter.model?.trim() || "";
      if (inverterBrand && inverterModel && eq.inverter.count > 0) {
        const key = `INVERTER:${inverterBrand.toLowerCase()}:${inverterModel.toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "INVERTER",
            brand: inverterBrand,
            model: inverterModel,
            unitSpec: eq.inverter.sizeKwac || null,
            unitLabel: "kW AC",
          });
        }
      }

      // Batteries
      const batteryBrand = eq.battery.brand?.trim() || "";
      const batteryModel = eq.battery.model?.trim() || "";
      if (batteryBrand && batteryModel && eq.battery.count > 0) {
        const key = `BATTERY:${batteryBrand.toLowerCase()}:${batteryModel.toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "BATTERY",
            brand: batteryBrand,
            model: batteryModel,
            unitSpec: eq.battery.sizeKwh || null,
            unitLabel: "kWh",
          });
        }
      }

      // EV Chargers
      if (eq.evCount > 0) {
        const key = "EV_CHARGER:generic:ev charger";
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "EV_CHARGER",
            brand: "Generic",
            model: "EV Charger",
            unitSpec: null,
            unitLabel: null,
          });
        }
      }
    }

    // Upsert each unique SKU into EquipmentSku
    let created = 0;
    let existing = 0;

    for (const sku of skuMap.values()) {
      const result = await prisma.equipmentSku.upsert({
        where: {
          category_brand_model: {
            category: sku.category,
            brand: sku.brand,
            model: sku.model,
          },
        },
        update: {
          unitSpec: sku.unitSpec,
          unitLabel: sku.unitLabel,
          isActive: true,
        },
        create: {
          category: sku.category,
          brand: sku.brand,
          model: sku.model,
          unitSpec: sku.unitSpec,
          unitLabel: sku.unitLabel,
        },
      });

      // If createdAt equals updatedAt this is a newly created record
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        existing++;
      }
    }

    const total = created + existing;

    // Log activity
    await logActivity({
      type: "INVENTORY_SKU_SYNCED",
      description: `SKU sync: ${created} created, ${existing} existing (${total} total from ${equipmentProjects.length} projects)`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "inventory",
      metadata: {
        created,
        existing,
        total,
        projectsScanned: equipmentProjects.length,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/inventory/sync-skus",
      requestMethod: "POST",
      responseStatus: 200,
    });

    return NextResponse.json({
      created,
      existing,
      total,
      projectsScanned: equipmentProjects.length,
    });
  } catch (error) {
    console.error("Error syncing SKUs from HubSpot:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to sync SKUs" },
      { status: 500 }
    );
  }
}
