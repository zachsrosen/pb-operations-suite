# Inventory Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Inventory Hub dashboard that tracks warehouse stock levels per SKU per location and compares supply against pipeline demand to surface procurement gaps.

**Architecture:** New `/dashboards/inventory` page with three tabs (Stock Overview, Receive & Adjust, Needs Report). Prisma models for SKU catalog, stock levels, and transaction history. Six API routes under `/api/inventory/`. Piggybacks on existing HubSpot project cache for demand data.

**Tech Stack:** Next.js 16.1, React 19.2, Prisma 7.3, Tailwind v4, existing DashboardShell/MetricCard/MultiSelectFilter/ToastContext components.

**Design doc:** `docs/plans/2025-02-13-inventory-hub-design.md`

---

## Task 1: Prisma Schema — Enums & Models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add EquipmentCategory enum after the ActivityType enum (after line 133)**

```prisma
// ===========================================
// INVENTORY MANAGEMENT
// ===========================================

enum EquipmentCategory {
  MODULE
  INVERTER
  BATTERY
  EV_CHARGER
}

enum TransactionType {
  RECEIVED
  ALLOCATED
  ADJUSTED
  TRANSFERRED
  RETURNED
}
```

**Step 2: Add new ActivityType values**

Add these to the existing `ActivityType` enum (before the closing brace, after `FEATURE_USED`):

```prisma
  // Inventory
  INVENTORY_RECEIVED
  INVENTORY_ADJUSTED
  INVENTORY_ALLOCATED
  INVENTORY_TRANSFERRED
  INVENTORY_SKU_SYNCED
```

**Step 3: Add EquipmentSku model**

```prisma
model EquipmentSku {
  id          String            @id @default(cuid())
  category    EquipmentCategory
  brand       String
  model       String
  unitSpec    Float?            // Wattage for modules, kW for inverters, kWh for batteries
  unitLabel   String?           // "W", "kW AC", "kWh"
  isActive    Boolean           @default(true)

  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  // Relations
  stockLevels InventoryStock[]

  @@unique([category, brand, model])
  @@index([category])
  @@index([isActive])
}
```

**Step 4: Add InventoryStock model**

```prisma
model InventoryStock {
  id              String       @id @default(cuid())
  skuId           String
  sku             EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  location        String       // PB Location = warehouse
  quantityOnHand  Int          @default(0)
  minStockLevel   Int?         // Optional reorder threshold (future)
  lastCountedAt   DateTime?

  updatedAt       DateTime     @updatedAt

  // Relations
  transactions    StockTransaction[]

  @@unique([skuId, location])
  @@index([skuId])
  @@index([location])
}
```

**Step 5: Add StockTransaction model**

```prisma
model StockTransaction {
  id            String          @id @default(cuid())
  stockId       String
  stock         InventoryStock  @relation(fields: [stockId], references: [id], onDelete: Cascade)
  type          TransactionType
  quantity      Int             // Positive = added, negative = removed
  reason        String?
  projectId     String?         // HubSpot deal ID if project-related
  projectName   String?
  performedBy   String?         // User name or email

  createdAt     DateTime        @default(now())

  @@index([stockId])
  @@index([type])
  @@index([projectId])
  @@index([createdAt])
}
```

**Step 6: Run Prisma generate and create migration**

Run: `cd /Users/zach/Downloads/PB-Operations-Suite && npx prisma generate`
Expected: "Generated Prisma Client"

Run: `npx prisma db push`
Expected: Schema synced to database

**Step 7: Commit**

```bash
git add prisma/schema.prisma src/generated/
git commit -m "feat(inventory): add Prisma models for EquipmentSku, InventoryStock, StockTransaction"
```

---

## Task 2: API Route — SKUs (GET & POST)

**Files:**
- Create: `src/app/api/inventory/skus/route.ts`

**Step 1: Create the SKUs API route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const activeOnly = searchParams.get("active") !== "false";

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (activeOnly) where.isActive = true;

    const skus = await prisma.equipmentSku.findMany({
      where,
      include: {
        stockLevels: {
          select: { location: true, quantityOnHand: true },
        },
      },
      orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
    });

    return NextResponse.json({ skus, count: skus.length });
  } catch (error) {
    console.error("GET /api/inventory/skus error:", error);
    return NextResponse.json(
      { error: "Failed to fetch SKUs", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    // Role check: ADMIN, OWNER, MANAGER only
    const writeRoles = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER"];
    if (!writeRoles.includes(authResult.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = await request.json();
    const { category, brand, model, unitSpec, unitLabel } = body;

    if (!category || !brand || !model) {
      return NextResponse.json(
        { error: "category, brand, and model are required" },
        { status: 400 }
      );
    }

    const sku = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category,
          brand: brand.trim(),
          model: model.trim(),
        },
      },
      update: {
        unitSpec: unitSpec ?? undefined,
        unitLabel: unitLabel ?? undefined,
        isActive: true,
      },
      create: {
        category,
        brand: brand.trim(),
        model: model.trim(),
        unitSpec: unitSpec ?? null,
        unitLabel: unitLabel ?? null,
      },
    });

    return NextResponse.json({ sku }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/skus error:", error);
    return NextResponse.json(
      { error: "Failed to create SKU", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/inventory/skus/route.ts
git commit -m "feat(inventory): add SKUs API route (GET list, POST create/upsert)"
```

---

## Task 3: API Route — Stock (GET & PUT)

**Files:**
- Create: `src/app/api/inventory/stock/route.ts`
- Create: `src/app/api/inventory/stock/[id]/route.ts`

**Step 1: Create the stock list route**

`src/app/api/inventory/stock/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get("location");
    const category = searchParams.get("category");
    const shortfallsOnly = searchParams.get("shortfalls") === "true";

    const where: Record<string, unknown> = {};
    if (location) where.location = location;
    if (category) where.sku = { category, isActive: true };
    else where.sku = { isActive: true };

    const stock = await prisma.inventoryStock.findMany({
      where,
      include: {
        sku: true,
      },
      orderBy: [
        { sku: { category: "asc" } },
        { sku: { brand: "asc" } },
        { location: "asc" },
      ],
    });

    // If shortfalls filter is on, we need demand data to compare
    // This is handled client-side since demand comes from HubSpot cache

    return NextResponse.json({ stock, count: stock.length });
  } catch (error) {
    console.error("GET /api/inventory/stock error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Create the stock update route**

`src/app/api/inventory/stock/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const writeRoles = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER", "OPERATIONS", "OPERATIONS_MANAGER"];
    if (!writeRoles.includes(authResult.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { minStockLevel } = body;

    const stock = await prisma.inventoryStock.update({
      where: { id },
      data: {
        minStockLevel: minStockLevel ?? undefined,
        lastCountedAt: new Date(),
      },
      include: { sku: true },
    });

    return NextResponse.json({ stock });
  } catch (error) {
    console.error("PUT /api/inventory/stock error:", error);
    return NextResponse.json(
      { error: "Failed to update stock", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/inventory/stock/
git commit -m "feat(inventory): add stock API routes (GET list, PUT update)"
```

---

## Task 4: API Route — Transactions (GET & POST)

**Files:**
- Create: `src/app/api/inventory/transactions/route.ts`

**Step 1: Create the transactions API route**

This is the core route — every stock change flows through here. POST creates a transaction AND atomically updates the stock level.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get("location");
    const type = searchParams.get("type");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (location) where.stock = { location };

    const transactions = await prisma.stockTransaction.findMany({
      where,
      include: {
        stock: {
          include: { sku: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });

    return NextResponse.json({ transactions, count: transactions.length });
  } catch (error) {
    console.error("GET /api/inventory/transactions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const writeRoles = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER", "OPERATIONS", "OPERATIONS_MANAGER"];
    if (!writeRoles.includes(authResult.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = await request.json();
    const { skuId, location, type, quantity, reason, projectId, projectName } = body;

    if (!skuId || !location || !type || quantity === undefined || quantity === 0) {
      return NextResponse.json(
        { error: "skuId, location, type, and non-zero quantity are required" },
        { status: 400 }
      );
    }

    // Determine signed quantity based on transaction type
    const signedQty = (type === "RECEIVED" || type === "RETURNED")
      ? Math.abs(quantity)
      : (type === "ALLOCATED")
        ? -Math.abs(quantity)
        : quantity; // ADJUSTED and TRANSFERRED keep the sign as provided

    // Upsert the stock record and create transaction atomically
    const result = await prisma.$transaction(async (tx) => {
      // Upsert InventoryStock — create if first time receiving at this location
      const stock = await tx.inventoryStock.upsert({
        where: {
          skuId_location: { skuId, location },
        },
        create: {
          skuId,
          location,
          quantityOnHand: signedQty,
          lastCountedAt: type === "ADJUSTED" ? new Date() : null,
        },
        update: {
          quantityOnHand: { increment: signedQty },
          lastCountedAt: type === "ADJUSTED" ? new Date() : undefined,
        },
        include: { sku: true },
      });

      // Create the transaction record
      const transaction = await tx.stockTransaction.create({
        data: {
          stockId: stock.id,
          type,
          quantity: signedQty,
          reason: reason || null,
          projectId: projectId || null,
          projectName: projectName || null,
          performedBy: authResult.name || authResult.email,
        },
      });

      return { stock, transaction };
    });

    // Log activity
    const activityTypeMap: Record<string, string> = {
      RECEIVED: "INVENTORY_RECEIVED",
      ADJUSTED: "INVENTORY_ADJUSTED",
      ALLOCATED: "INVENTORY_ALLOCATED",
      TRANSFERRED: "INVENTORY_TRANSFERRED",
      RETURNED: "INVENTORY_RECEIVED",
    };

    await logActivity({
      type: activityTypeMap[type] || "INVENTORY_RECEIVED",
      description: `${type.toLowerCase()} ${Math.abs(signedQty)}x ${result.stock.sku.brand} ${result.stock.sku.model} at ${location}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "inventory",
      entityId: result.stock.id,
      entityName: `${result.stock.sku.brand} ${result.stock.sku.model}`,
      pbLocation: location,
      metadata: {
        transactionId: result.transaction.id,
        skuId,
        quantity: signedQty,
        type,
        projectId,
        newOnHand: result.stock.quantityOnHand,
      },
    }).catch((err) => console.error("Activity log error:", err));

    return NextResponse.json({
      stock: result.stock,
      transaction: result.transaction,
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/transactions error:", error);
    return NextResponse.json(
      { error: "Failed to create transaction", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/inventory/transactions/route.ts
git commit -m "feat(inventory): add transactions API with atomic stock updates and activity logging"
```

---

## Task 5: API Route — Sync SKUs from HubSpot

**Files:**
- Create: `src/app/api/inventory/sync-skus/route.ts`

**Step 1: Create the sync route**

```typescript
import { NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, filterProjectsForContext } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function POST() {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const adminRoles = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER"];
    if (!adminRoles.includes(authResult.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Fetch projects using the same cache as equipment backlog
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: true }),
      false
    );

    const projects = filterProjectsForContext(allProjects || [], "equipment");

    // Extract unique SKU tuples
    interface SkuTuple {
      category: "MODULE" | "INVERTER" | "BATTERY" | "EV_CHARGER";
      brand: string;
      model: string;
      unitSpec: number | null;
      unitLabel: string | null;
    }

    const skuMap = new Map<string, SkuTuple>();

    for (const project of projects) {
      const eq = project.equipment;
      if (!eq) continue;

      // Modules
      if (eq.modules?.brand && eq.modules?.model && eq.modules.count > 0) {
        const key = `MODULE:${eq.modules.brand.trim().toLowerCase()}:${eq.modules.model.trim().toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "MODULE",
            brand: eq.modules.brand.trim(),
            model: eq.modules.model.trim(),
            unitSpec: eq.modules.wattage || null,
            unitLabel: "W",
          });
        }
      }

      // Inverters
      if (eq.inverter?.brand && eq.inverter?.model && eq.inverter.count > 0) {
        const key = `INVERTER:${eq.inverter.brand.trim().toLowerCase()}:${eq.inverter.model.trim().toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "INVERTER",
            brand: eq.inverter.brand.trim(),
            model: eq.inverter.model.trim(),
            unitSpec: eq.inverter.sizeKwac || null,
            unitLabel: "kW AC",
          });
        }
      }

      // Batteries
      if (eq.battery?.brand && eq.battery?.model && eq.battery.count > 0) {
        const key = `BATTERY:${eq.battery.brand.trim().toLowerCase()}:${eq.battery.model.trim().toLowerCase()}`;
        if (!skuMap.has(key)) {
          skuMap.set(key, {
            category: "BATTERY",
            brand: eq.battery.brand.trim(),
            model: eq.battery.model.trim(),
            unitSpec: eq.battery.sizeKwh || null,
            unitLabel: "kWh",
          });
        }
      }

      // EV Chargers — treated as generic SKU (no brand/model in HubSpot)
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

    // Upsert all SKUs
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
        create: {
          category: sku.category,
          brand: sku.brand,
          model: sku.model,
          unitSpec: sku.unitSpec,
          unitLabel: sku.unitLabel,
        },
        update: {
          // Update spec if it was previously null
          unitSpec: sku.unitSpec ?? undefined,
          unitLabel: sku.unitLabel ?? undefined,
        },
      });

      // Check if it was just created by comparing timestamps
      const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
      if (isNew) created++;
      else existing++;
    }

    await logActivity({
      type: "INVENTORY_SKU_SYNCED",
      description: `Synced SKU catalog: ${created} new, ${existing} existing from ${projects.length} projects`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "inventory",
      metadata: { created, existing, totalProjects: projects.length },
    }).catch((err) => console.error("Activity log error:", err));

    return NextResponse.json({
      created,
      existing,
      total: skuMap.size,
      projectsScanned: projects.length,
    });
  } catch (error) {
    console.error("POST /api/inventory/sync-skus error:", error);
    return NextResponse.json(
      { error: "Failed to sync SKUs", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/inventory/sync-skus/route.ts
git commit -m "feat(inventory): add SKU sync route that auto-populates catalog from HubSpot projects"
```

---

## Task 6: API Route — Needs Report

**Files:**
- Create: `src/app/api/inventory/needs/route.ts`

**Step 1: Create the needs report route**

This route computes stage-weighted demand vs. supply for every SKU.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAllProjects, filterProjectsForContext } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// Default stage weights — how likely is this stage to actually need equipment
const DEFAULT_STAGE_WEIGHTS: Record<string, number> = {
  "Construction": 1.0,
  "Ready To Build": 1.0,
  "RTB - Blocked": 0.8,
  "Permitting & Interconnection": 0.8,
  "Design & Engineering": 0.5,
  "Site Survey": 0.25,
  "Inspection": 0.5,           // Already built, may need replacements
  "Permission To Operate": 0.1, // Almost done
  "Close Out": 0.0,
};

interface DemandBySkuLocation {
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

export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    // Parse optional custom stage weights from query params
    const searchParams = request.nextUrl.searchParams;
    const customWeightsParam = searchParams.get("weights");
    let stageWeights = DEFAULT_STAGE_WEIGHTS;
    if (customWeightsParam) {
      try {
        stageWeights = { ...DEFAULT_STAGE_WEIGHTS, ...JSON.parse(customWeightsParam) };
      } catch {
        // Ignore invalid JSON, use defaults
      }
    }

    // Fetch demand from HubSpot projects (same cache as equipment backlog)
    const { data: allProjects, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: true }),
      false
    );

    const projects = filterProjectsForContext(allProjects || [], "equipment");

    // Build demand map: key = "CATEGORY:brand:model:location"
    const demandMap = new Map<string, DemandBySkuLocation>();

    for (const project of projects) {
      const eq = project.equipment;
      const loc = project.pbLocation || "Unknown";
      const stage = project.stage || "Unknown";
      const weight = stageWeights[stage] ?? 0.5;

      if (!eq) continue;

      // Modules
      if (eq.modules?.brand && eq.modules?.model && eq.modules.count > 0) {
        const key = `MODULE:${eq.modules.brand.trim()}:${eq.modules.model.trim()}:${loc}`;
        const entry = demandMap.get(key) || {
          brand: eq.modules.brand.trim(),
          model: eq.modules.model.trim(),
          category: "MODULE",
          unitSpec: eq.modules.wattage || null,
          unitLabel: "W",
          location: loc,
          rawDemand: 0,
          weightedDemand: 0,
          projectCount: 0,
        };
        entry.rawDemand += eq.modules.count;
        entry.weightedDemand += Math.round(eq.modules.count * weight);
        entry.projectCount += 1;
        demandMap.set(key, entry);
      }

      // Inverters
      if (eq.inverter?.brand && eq.inverter?.model && eq.inverter.count > 0) {
        const key = `INVERTER:${eq.inverter.brand.trim()}:${eq.inverter.model.trim()}:${loc}`;
        const entry = demandMap.get(key) || {
          brand: eq.inverter.brand.trim(),
          model: eq.inverter.model.trim(),
          category: "INVERTER",
          unitSpec: eq.inverter.sizeKwac || null,
          unitLabel: "kW AC",
          location: loc,
          rawDemand: 0,
          weightedDemand: 0,
          projectCount: 0,
        };
        entry.rawDemand += eq.inverter.count;
        entry.weightedDemand += Math.round(eq.inverter.count * weight);
        entry.projectCount += 1;
        demandMap.set(key, entry);
      }

      // Batteries
      if (eq.battery?.brand && eq.battery?.model && eq.battery.count > 0) {
        const totalBatteries = eq.battery.count + (eq.battery.expansionCount || 0);
        const key = `BATTERY:${eq.battery.brand.trim()}:${eq.battery.model.trim()}:${loc}`;
        const entry = demandMap.get(key) || {
          brand: eq.battery.brand.trim(),
          model: eq.battery.model.trim(),
          category: "BATTERY",
          unitSpec: eq.battery.sizeKwh || null,
          unitLabel: "kWh",
          location: loc,
          rawDemand: 0,
          weightedDemand: 0,
          projectCount: 0,
        };
        entry.rawDemand += totalBatteries;
        entry.weightedDemand += Math.round(totalBatteries * weight);
        entry.projectCount += 1;
        demandMap.set(key, entry);
      }

      // EV Chargers
      if (eq.evCount > 0) {
        const key = `EV_CHARGER:Generic:EV Charger:${loc}`;
        const entry = demandMap.get(key) || {
          brand: "Generic",
          model: "EV Charger",
          category: "EV_CHARGER",
          unitSpec: null,
          unitLabel: null,
          location: loc,
          rawDemand: 0,
          weightedDemand: 0,
          projectCount: 0,
        };
        entry.rawDemand += eq.evCount;
        entry.weightedDemand += Math.round(eq.evCount * weight);
        entry.projectCount += 1;
        demandMap.set(key, entry);
      }
    }

    // Fetch all stock levels
    const stockRecords = await prisma.inventoryStock.findMany({
      include: { sku: true },
    });

    // Build stock map: key = "CATEGORY:brand:model:location"
    const stockMap = new Map<string, number>();
    for (const s of stockRecords) {
      const key = `${s.sku.category}:${s.sku.brand}:${s.sku.model}:${s.location}`;
      stockMap.set(key, s.quantityOnHand);
    }

    // Merge demand + supply into needs report
    const needs = Array.from(demandMap.entries()).map(([key, demand]) => {
      const onHand = stockMap.get(key) || 0;
      const gap = demand.weightedDemand - onHand;
      return {
        ...demand,
        onHand,
        gap,
        suggestedOrder: Math.max(0, gap),
      };
    });

    // Sort by category, then by gap descending (biggest shortfalls first)
    needs.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return b.gap - a.gap;
    });

    // Compute summary stats
    const summary = {
      totalSkus: new Set(needs.map(n => `${n.category}:${n.brand}:${n.model}`)).size,
      totalShortfalls: needs.filter(n => n.gap > 0).length,
      totalSurplus: needs.filter(n => n.gap < 0).length,
      totalBalanced: needs.filter(n => n.gap === 0).length,
    };

    return NextResponse.json({
      needs,
      summary,
      stageWeights,
      lastUpdated,
      projectsAnalyzed: projects.length,
    });
  } catch (error) {
    console.error("GET /api/inventory/needs error:", error);
    return NextResponse.json(
      { error: "Failed to generate needs report", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/inventory/needs/route.ts
git commit -m "feat(inventory): add needs report API with stage-weighted demand vs supply gap analysis"
```

---

## Task 7: Navigation & Permissions Wiring

**Files:**
- Modify: `src/components/DashboardShell.tsx:16` — add SUITE_MAP entry
- Modify: `src/components/GlobalSearch.tsx:31` — add search entry
- Modify: `src/app/suites/operations/page.tsx:34-39` — add LINKS entry
- Modify: `src/lib/role-permissions.ts` — add `/dashboards/inventory` and `/api/inventory` to allowed routes

**Step 1: Add to DashboardShell SUITE_MAP**

In `src/components/DashboardShell.tsx`, after the equipment-backlog line (line 16), add:

```typescript
  "/dashboards/inventory": { href: "/suites/operations", label: "Operations" },
```

**Step 2: Add to GlobalSearch**

In `src/components/GlobalSearch.tsx`, after the Equipment Backlog entry (line 31), add:

```typescript
  { name: "Inventory Hub", path: "/dashboards/inventory", description: "Stock levels, receiving, and procurement gap analysis" },
```

**Step 3: Add to Operations Suite page**

In `src/app/suites/operations/page.tsx`, after the equipment-backlog entry (after line 39), add:

```typescript
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
  },
```

**Step 4: Add routes to role-permissions.ts**

Add `/dashboards/inventory` and `/api/inventory` to these roles' `allowedRoutes`:
- `OPERATIONS` (after line 110)
- `OPERATIONS_MANAGER` (after line 133)
- `PROJECT_MANAGER` (after line 158)
- `MANAGER` (after line 80)

**Step 5: Commit**

```bash
git add src/components/DashboardShell.tsx src/components/GlobalSearch.tsx src/app/suites/operations/page.tsx src/lib/role-permissions.ts
git commit -m "feat(inventory): wire up navigation, global search, operations suite, and role permissions"
```

---

## Task 8: Dashboard Page — Shell, State & Data Fetching

**Files:**
- Create: `src/app/dashboards/inventory/page.tsx`

**Step 1: Create the page with shell, types, state, and data fetching**

This creates the page skeleton with all state management and data fetching. The three tab views will be built in subsequent tasks.

```typescript
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useToast } from "@/contexts/ToastContext";
import { formatRelativeDate } from "@/lib/format";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EquipmentSku {
  id: string;
  category: "MODULE" | "INVERTER" | "BATTERY" | "EV_CHARGER";
  brand: string;
  model: string;
  unitSpec: number | null;
  unitLabel: string | null;
  isActive: boolean;
  stockLevels: { location: string; quantityOnHand: number }[];
}

interface StockRecord {
  id: string;
  skuId: string;
  location: string;
  quantityOnHand: number;
  minStockLevel: number | null;
  lastCountedAt: string | null;
  sku: EquipmentSku;
}

interface Transaction {
  id: string;
  stockId: string;
  type: "RECEIVED" | "ALLOCATED" | "ADJUSTED" | "TRANSFERRED" | "RETURNED";
  quantity: number;
  reason: string | null;
  projectId: string | null;
  projectName: string | null;
  performedBy: string | null;
  createdAt: string;
  stock: StockRecord;
}

interface NeedRow {
  brand: string;
  model: string;
  category: string;
  unitSpec: number | null;
  unitLabel: string | null;
  location: string;
  rawDemand: number;
  weightedDemand: number;
  projectCount: number;
  onHand: number;
  gap: number;
  suggestedOrder: number;
}

interface NeedsReport {
  needs: NeedRow[];
  summary: {
    totalSkus: number;
    totalShortfalls: number;
    totalSurplus: number;
    totalBalanced: number;
  };
  stageWeights: Record<string, number>;
  lastUpdated: string | null;
  projectsAnalyzed: number;
}

type TabView = "overview" | "receive" | "needs";

const CATEGORY_LABELS: Record<string, string> = {
  MODULE: "Modules",
  INVERTER: "Inverters",
  BATTERY: "Batteries",
  EV_CHARGER: "EV Chargers",
};

const CATEGORY_ORDER = ["MODULE", "INVERTER", "BATTERY", "EV_CHARGER"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InventoryHubPage() {
  useActivityTracking();
  const { addToast } = useToast();

  // Tab state
  const [tab, setTab] = useState<TabView>("overview");

  // Data state
  const [skus, setSkus] = useState<EquipmentSku[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [needsReport, setNeedsReport] = useState<NeedsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  /* ---- Data fetching ---- */

  const fetchAll = useCallback(async () => {
    try {
      const [skuRes, stockRes, txRes, needsRes] = await Promise.all([
        fetch("/api/inventory/skus"),
        fetch("/api/inventory/stock"),
        fetch("/api/inventory/transactions?limit=50"),
        fetch("/api/inventory/needs"),
      ]);

      if (!skuRes.ok || !stockRes.ok || !txRes.ok || !needsRes.ok) {
        throw new Error("One or more API calls failed");
      }

      const [skuData, stockData, txData, needsData] = await Promise.all([
        skuRes.json(),
        stockRes.json(),
        txRes.json(),
        needsRes.json(),
      ]);

      setSkus(skuData.skus || []);
      setStock(stockData.stock || []);
      setTransactions(txData.transactions || []);
      setNeedsReport(needsData);
      setError(null);
    } catch (err) {
      console.error("Inventory fetch error:", err);
      setError("Failed to load inventory data. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  /* ---- SKU sync ---- */

  const handleSyncSkus = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/inventory/sync-skus", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      addToast({
        type: "success",
        title: "SKU catalog synced",
        message: `${data.created} new SKUs from ${data.projectsScanned} projects`,
      });
      await fetchAll();
    } catch {
      addToast({ type: "error", title: "Sync failed", message: "Could not sync SKUs from HubSpot" });
    } finally {
      setSyncing(false);
    }
  }, [addToast, fetchAll]);

  /* ---- Derived data ---- */

  const locations = useMemo(
    () =>
      [...new Set(stock.map((s) => s.location))]
        .filter((l) => l && l !== "Unknown")
        .sort()
        .map((l) => ({ value: l, label: l })),
    [stock]
  );

  const categoryOptions = useMemo(
    () =>
      CATEGORY_ORDER.filter((c) => skus.some((s) => s.category === c)).map((c) => ({
        value: c,
        label: CATEGORY_LABELS[c] || c,
      })),
    [skus]
  );

  const filteredStock = useMemo(() => {
    return stock.filter((s) => {
      if (filterLocations.length && !filterLocations.includes(s.location)) return false;
      if (filterCategories.length && !filterCategories.includes(s.sku.category)) return false;
      return true;
    });
  }, [stock, filterLocations, filterCategories]);

  /* ---- Stats ---- */

  const stats = useMemo(() => {
    const totalUnits = filteredStock.reduce((sum, s) => sum + s.quantityOnHand, 0);
    const belowMin = filteredStock.filter(
      (s) => s.minStockLevel !== null && s.quantityOnHand < s.minStockLevel
    ).length;
    const totalDemand = needsReport?.needs
      .filter((n) => {
        if (filterLocations.length && !filterLocations.includes(n.location)) return false;
        if (filterCategories.length && !filterCategories.includes(n.category)) return false;
        return true;
      })
      .reduce((sum, n) => sum + n.weightedDemand, 0) || 0;

    return {
      totalSkus: skus.filter((s) => s.isActive).length,
      totalUnits,
      belowMin,
      totalDemand,
    };
  }, [filteredStock, skus, needsReport, filterLocations, filterCategories]);

  /* ---- Loading / Error ---- */

  if (loading) {
    return (
      <DashboardShell title="Inventory Hub" accentColor="cyan">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Inventory Hub" accentColor="cyan">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); fetchAll(); }}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  /* ---- Render ---- */

  return (
    <DashboardShell
      title="Inventory Hub"
      subtitle={`${stats.totalSkus} SKUs tracked \u2022 ${stats.totalUnits.toLocaleString()} units on hand`}
      accentColor="cyan"
      lastUpdated={needsReport?.lastUpdated || null}
    >
      {/* Filters + Tab Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MultiSelectFilter
          label="Location"
          options={locations}
          selected={filterLocations}
          onChange={setFilterLocations}
          accentColor="orange"
        />
        <MultiSelectFilter
          label="Category"
          options={categoryOptions}
          selected={filterCategories}
          onChange={setFilterCategories}
          accentColor="cyan"
        />
        <button
          onClick={handleSyncSkus}
          disabled={syncing}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 text-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Sync SKUs"}
        </button>

        <div className="ml-auto flex bg-surface-2 rounded-lg p-0.5">
          {(["overview", "receive", "needs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t ? "bg-cyan-600 text-white" : "text-muted hover:text-foreground"
              }`}
            >
              {t === "overview" ? "Stock Overview" : t === "receive" ? "Receive & Adjust" : "Needs Report"}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "SKUs Tracked", value: stats.totalSkus, color: "text-cyan-400" },
          { label: "Units On Hand", value: stats.totalUnits.toLocaleString(), color: "text-green-400" },
          { label: "Below Min Level", value: stats.belowMin, color: stats.belowMin > 0 ? "text-red-400" : "text-muted" },
          { label: "Pipeline Demand", value: stats.totalDemand.toLocaleString(), color: "text-orange-400" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
            <div className={`text-xl font-bold ${stat.color}`} key={String(stat.value)}>
              {stat.value}
            </div>
            <div className="text-xs text-muted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {skus.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-muted text-sm">No inventory tracked yet.</p>
          <button
            onClick={handleSyncSkus}
            disabled={syncing}
            className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync SKU Catalog from HubSpot"}
          </button>
        </div>
      ) : (
        <>
          {/* Tab content rendered in subsequent tasks */}
          {tab === "overview" && (
            <StockOverviewTab stock={filteredStock} needsReport={needsReport} filterLocations={filterLocations} filterCategories={filterCategories} />
          )}
          {tab === "receive" && (
            <ReceiveAdjustTab skus={skus} transactions={transactions} onTransactionCreated={fetchAll} />
          )}
          {tab === "needs" && (
            <NeedsReportTab needsReport={needsReport} filterLocations={filterLocations} filterCategories={filterCategories} />
          )}
        </>
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Placeholder tab components — filled in Tasks 9, 10, 11            */
/* ------------------------------------------------------------------ */

function StockOverviewTab(_props: {
  stock: StockRecord[];
  needsReport: NeedsReport | null;
  filterLocations: string[];
  filterCategories: string[];
}) {
  return <div className="text-muted text-sm text-center py-8">Stock Overview — building...</div>;
}

function ReceiveAdjustTab(_props: {
  skus: EquipmentSku[];
  transactions: Transaction[];
  onTransactionCreated: () => Promise<void>;
}) {
  return <div className="text-muted text-sm text-center py-8">Receive &amp; Adjust — building...</div>;
}

function NeedsReportTab(_props: {
  needsReport: NeedsReport | null;
  filterLocations: string[];
  filterCategories: string[];
}) {
  return <div className="text-muted text-sm text-center py-8">Needs Report — building...</div>;
}
```

**Step 2: Verify it loads**

Run: `cd /Users/zach/Downloads/PB-Operations-Suite && npx next build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "feat(inventory): add Inventory Hub page with shell, data fetching, stats, tabs, and SKU sync"
```

---

## Task 9: Stock Overview Tab

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx` — replace `StockOverviewTab` placeholder

**Step 1: Replace the StockOverviewTab function**

Replace the placeholder `StockOverviewTab` with the full implementation. This tab shows a table of all stock records with demand comparison and gap indicators.

The component should:
- Show a sortable table: Category badge | Brand | Model | Spec | Location | On Hand | Demand | Gap | Last Counted
- Gap column: red chip for shortfalls, green for surplus, muted for balanced
- Category column uses colored badge text (no icon library needed — just colored text labels like "MOD", "INV", "BAT", "EV")
- Last Counted shows relative time with amber warning if > 30 days or never
- Build demand lookup by matching stock records against the needs report data by `(category, brand, model, location)`
- Sortable on all numeric columns
- "Show shortfalls only" toggle

**Step 2: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "feat(inventory): implement Stock Overview tab with gap indicators and sorting"
```

---

## Task 10: Receive & Adjust Tab

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx` — replace `ReceiveAdjustTab` placeholder

**Step 1: Replace the ReceiveAdjustTab function**

Replace the placeholder `ReceiveAdjustTab` with the full implementation. This tab has:

**Quick entry form:**
- SKU selector: `<select>` grouped by category with search/filter via a text input above it. Show "brand — model (spec)" per option.
- Location selector: `<select>` with PB Locations from `LOCATION_COLORS` keys in constants (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo)
- Quantity: Number input with min=1
- Transaction type: Radio buttons — Received (green ring), Adjusted (amber ring), Returned (blue ring), Allocated (orange ring)
- When "Allocated" is selected: Show project search input that fetches from `/api/projects?search=QUERY&limit=10&fields=id,name,projectNumber` on debounced input
- Reason: Optional text input
- Submit button: "Record Transaction"

**On submit:**
- POST to `/api/inventory/transactions`
- Show toast on success: "47x REC Alpha 400W received at Westminster"
- Call `onTransactionCreated()` to refresh all data

**Recent transactions list below the form:**
- Compact table: Time (relative) | SKU | Location | Type (color badge) | Qty (+/-) | Note | By
- Show last 50, newest first

**Step 2: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "feat(inventory): implement Receive & Adjust tab with quick entry form and transaction history"
```

---

## Task 11: Needs Report Tab

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx` — replace `NeedsReportTab` placeholder

**Step 1: Replace the NeedsReportTab function**

Replace the placeholder `NeedsReportTab` with the full implementation. This tab has:

**Stage weight controls:**
- Row of inline number inputs at the top, one per stage, pre-filled from `needsReport.stageWeights`
- When changed, refetch `/api/inventory/needs?weights=JSON.stringify(customWeights)`
- Show as compact grid: "Construction: [100%] Ready To Build: [100%] Permitting: [80%] ..." etc.

**Summary health bar:**
- Horizontal stacked bar showing % shortfall (red) vs surplus (green) vs balanced (muted)
- Labels: "X shortfalls | Y surplus | Z balanced"

**Needs table:**
- Grouped by category with section headers ("Modules", "Inverters", "Batteries", "EV Chargers")
- Columns: Brand | Model | Spec | Weighted Demand | On Hand | Gap | Suggested Order
- Gap column: red for positive (shortfall), green for negative (surplus), muted for zero
- Suggested Order: bold cyan number when > 0, dash when 0
- Rows sorted by gap descending within each category group
- Category subtotals row at bottom of each group

**Expandable location detail:**
- Click a row to expand and show per-location breakdown
- Sub-table: Location | Demand | On Hand | Gap
- Only show locations where demand > 0 or onHand > 0

**CSV export button:**
- Exports full report with all columns including per-location breakdown
- Filename: `inventory-needs-report-YYYY-MM-DD.csv`

**Step 2: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "feat(inventory): implement Needs Report tab with stage weights, health bar, and expandable detail"
```

---

## Task 12: Guide & Handbook Registration

**Files:**
- Modify: `src/app/handbook/page.tsx` — add Inventory Hub entry after Equipment Backlog (around line 220)
- Modify: `src/app/guide/page.tsx` — add DashboardCard for Inventory Hub (around line 665)

**Step 1: Add handbook entry**

After the Equipment Backlog entry in `src/app/handbook/page.tsx`, add:

```typescript
  {
    title: "Inventory Hub",
    route: "/dashboards/inventory",
    color: "cyan",
    audience: "Operations, Warehouse, Procurement",
    description: "Track warehouse stock levels per SKU per location. Compare supply against pipeline demand to identify procurement gaps. Quick-entry forms for receiving deliveries and adjusting counts.",
    features: [
      "Stock Overview with demand comparison and gap indicators",
      "Quick Receive & Adjust form for warehouse staff",
      "Stage-weighted Needs Report for procurement planning",
      "Auto-sync SKU catalog from HubSpot projects",
      "Transaction audit trail for all stock changes",
      "CSV export of needs report",
    ],
  },
```

**Step 2: Add guide DashboardCard**

After the Equipment Backlog DashboardCard in `src/app/guide/page.tsx`, add:

```tsx
        <DashboardCard
          title="Inventory Hub"
          tag="INVENTORY"
          tagColor="cyan"
          description="Track warehouse stock levels and identify procurement gaps."
          features={[
            "View current stock per SKU per warehouse location",
            "Record deliveries, adjustments, and allocations",
            "Stage-weighted demand vs. supply gap analysis",
            "Auto-sync SKU catalog from HubSpot project data",
            "Export needs report to CSV for procurement teams"
          ]}
          url="/dashboards/inventory"
        />
```

**Step 3: Commit**

```bash
git add src/app/handbook/page.tsx src/app/guide/page.tsx
git commit -m "feat(inventory): add Inventory Hub to handbook and guide pages"
```

---

## Task 13: Build Verification & Final Commit

**Step 1: Run build**

Run: `cd /Users/zach/Downloads/PB-Operations-Suite && npx next build`
Expected: Build succeeds with no errors

**Step 2: Fix any build errors**

If TypeScript or build errors appear, fix them.

**Step 3: Final verification commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix(inventory): resolve build errors"
```

---

## Task Summary

| Task | Description | Scope |
|------|-------------|-------|
| 1 | Prisma schema — enums & models | Schema |
| 2 | API: SKUs (GET/POST) | Backend |
| 3 | API: Stock (GET/PUT) | Backend |
| 4 | API: Transactions (GET/POST) | Backend |
| 5 | API: Sync SKUs from HubSpot | Backend |
| 6 | API: Needs Report | Backend |
| 7 | Navigation & permissions wiring | Integration |
| 8 | Dashboard page shell + data fetching | Frontend |
| 9 | Stock Overview tab | Frontend |
| 10 | Receive & Adjust tab | Frontend |
| 11 | Needs Report tab | Frontend |
| 12 | Guide & handbook registration | Docs |
| 13 | Build verification | QA |
