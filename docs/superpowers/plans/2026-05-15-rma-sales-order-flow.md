# RMA Sales Order Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of the RMA flow — manual part picker on service ticket detail that creates a tagged Zoho Sales Order for replacement parts, capturing both outbound and inbound (defective) items.

**Architecture:** New `RmaOrder` Prisma model with JSON line items, four API routes under `/api/service/rma/`, shared Zoho SO helpers extracted from `bom-so-create.ts`, and four React components on the service ticket detail panel. Feature-flagged with `RMA_ENABLED` (server) and `NEXT_PUBLIC_RMA_ENABLED` (client).

**Tech Stack:** Next.js API routes, Prisma, Zoho Inventory API, React Query, Tailwind CSS tokens

---

## Chunk 1: Schema, Helpers, and Feature Flags

### Task 1: Prisma Schema Additions

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `.env.example`

- [ ] **Step 1: Add RmaStatus enum and RmaOrder model**

Add after the last model in `prisma/schema.prisma` (line 4249):

```prisma
// ===========================================
// RMA (Return Merchandise Authorization)
// ===========================================

enum RmaStatus {
  DRAFT
  SO_CREATED
  RETURN_PENDING
  CLOSED
}

model RmaOrder {
  id            String    @id @default(cuid())
  ticketId      String
  ticketSubject String

  status        RmaStatus @default(DRAFT)

  outboundItems Json
  zohoSoId      String?
  zohoSoNumber  String?

  inboundItems     Json?
  returnReceivedAt DateTime?

  powerhubAlertId String?
  autoDetected    Boolean   @default(false)

  createdBy  String
  pbLocation String?
  notes      String?  @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([ticketId])
  @@index([status])
  @@index([zohoSoId])
  @@index([powerhubAlertId])
}
```

- [ ] **Step 2: Add ActivityType values**

In `prisma/schema.prisma`, add two new values at the end of the `ActivityType` enum (before the closing `}`), after `PE_EMAIL_SYNC` (line 309):

```prisma
  // RMA (Return Merchandise Authorization)
  RMA_ORDER_CREATED
  RMA_SO_CREATED
```

- [ ] **Step 3: Add RMA to PowerhubAlertSeverity**

In `prisma/schema.prisma`, add `RMA` to the `PowerhubAlertSeverity` enum (line 3991–3995):

```prisma
enum PowerhubAlertSeverity {
  INFORMATIONAL
  PERFORMANCE
  CRITICAL
  RMA
}
```

- [ ] **Step 4: Add Phase 2 TODO comment in powerhub-sync.ts**

In `src/lib/powerhub-sync.ts`, find the severity mapping (lines 554–558) and add a TODO comment:

```typescript
// TODO(Phase 2 RMA): map ReturnMerchandiseAuthorization → RMA here
const severity: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL" =
```

- [ ] **Step 5: Add feature flag env vars to .env.example**

Append to `.env.example`:

```
# RMA (Return Merchandise Authorization) — Phase 1 manual part picker
# Server: gates API routes (404 when falsy)
# Client: gates UI section on service ticket detail
RMA_ENABLED=false
NEXT_PUBLIC_RMA_ENABLED=false
```

- [ ] **Step 6: Run Prisma migration**

```bash
npx prisma migrate dev --name add_rma_order_model
```

Expected: migration creates `RmaOrder` table, adds `RMA_ORDER_CREATED`/`RMA_SO_CREATED` to ActivityType, adds `RMA` to PowerhubAlertSeverity.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ .env.example src/lib/powerhub-sync.ts
git commit -m "feat(rma): add RmaOrder model, RmaStatus enum, activity types, and feature flags"
```

### Task 2: Shared Zoho SO Helpers

**Files:**
- Create: `src/lib/zoho-so-helpers.ts`

- [ ] **Step 1: Create the helpers file**

```typescript
import { ZOHO_WAREHOUSE_IDS } from "@/lib/constants";
import type { ZohoSalesOrderLineItem } from "@/lib/zoho-inventory";
import type { EquipmentCategory } from "@/generated/prisma/enums";

export interface RmaLineItem {
  productId: string;
  brand: string;
  model: string;
  category: EquipmentCategory;
  quantity: number;
  unitSpecLabel?: string | null;
  zohoItemId?: string | null;
  hubspotProductId?: string | null;
  condition?: string | null;
}

export function resolveZohoWarehouse(
  pbLocation: string | null | undefined
): string | undefined {
  if (!pbLocation) return undefined;
  const id =
    ZOHO_WAREHOUSE_IDS[pbLocation] ??
    ZOHO_WAREHOUSE_IDS[pbLocation.toLowerCase()];
  if (!id) {
    console.warn(
      `[zoho-so-helpers] Unknown pb_location "${pbLocation}" — no warehouse mapped`
    );
  }
  return id;
}

export function buildZohoLineItems(
  items: RmaLineItem[],
  warehouseId?: string
): ZohoSalesOrderLineItem[] {
  return items.map((item) => ({
    ...(item.zohoItemId ? { item_id: item.zohoItemId } : {}),
    name: `${item.brand} ${item.model}`.trim() || "Unnamed Product",
    quantity: item.quantity,
    ...(warehouseId ? { warehouse_id: warehouseId } : {}),
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/zoho-so-helpers.ts
git commit -m "feat(rma): extract shared Zoho SO helpers (warehouse resolve, line item builder)"
```

### Task 3: RMA API Routes

**Files:**
- Create: `src/app/api/service/rma/route.ts` — POST (create draft) + GET (list by ticket)
- Create: `src/app/api/service/rma/[id]/route.ts` — GET (single detail)
- Create: `src/app/api/service/rma/[id]/create-so/route.ts` — POST (create Zoho SO)

- [ ] **Step 1: Create POST + GET /api/service/rma**

`src/app/api/service/rma/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import type { RmaLineItem } from "@/lib/zoho-so-helpers";

export async function POST(request: NextRequest) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await request.json();
  const { ticketId, ticketSubject, outboundItems, inboundItems, pbLocation, notes } = body as {
    ticketId?: string;
    ticketSubject?: string;
    outboundItems?: RmaLineItem[];
    inboundItems?: RmaLineItem[];
    pbLocation?: string | null;
    notes?: string | null;
  };

  if (!ticketId?.trim()) {
    return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  }
  if (!outboundItems || outboundItems.length === 0) {
    return NextResponse.json({ error: "At least one outbound item is required" }, { status: 400 });
  }

  // Validate product IDs exist
  const productIds = [
    ...outboundItems.map((i) => i.productId),
    ...(inboundItems ?? []).map((i) => i.productId),
  ];
  const products = await prisma.internalProduct.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      brand: true,
      model: true,
      category: true,
      unitSpec: true,
      unitLabel: true,
      zohoItemId: true,
      hubspotProductId: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Snapshot each item from the catalog
  const snapshotItems = (items: RmaLineItem[]): RmaLineItem[] =>
    items.map((item) => {
      const prod = productMap.get(item.productId);
      if (!prod) throw new Error(`Product ${item.productId} not found`);
      const unitSpecLabel =
        prod.unitSpec != null && prod.unitLabel
          ? `${prod.unitSpec}${prod.unitLabel}`
          : null;
      return {
        productId: item.productId,
        brand: prod.brand,
        model: prod.model,
        category: prod.category,
        quantity: item.quantity,
        unitSpecLabel,
        zohoItemId: prod.zohoItemId ?? null,
        hubspotProductId: prod.hubspotProductId ?? null,
        condition: item.condition ?? null,
      };
    });

  let snappedOutbound: RmaLineItem[];
  let snappedInbound: RmaLineItem[] | undefined;
  try {
    snappedOutbound = snapshotItems(outboundItems);
    if (inboundItems && inboundItems.length > 0) {
      snappedInbound = snapshotItems(inboundItems);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid product" },
      { status: 400 }
    );
  }

  const rmaOrder = await prisma.rmaOrder.create({
    data: {
      ticketId: ticketId.trim(),
      ticketSubject: ticketSubject || "",
      outboundItems: snappedOutbound as unknown as Record<string, unknown>[],
      inboundItems: snappedInbound
        ? (snappedInbound as unknown as Record<string, unknown>[])
        : undefined,
      pbLocation: pbLocation?.trim() || null,
      notes: notes?.trim() || null,
      createdBy: session.user.email,
    },
  });

  await logActivity({
    type: "RMA_ORDER_CREATED",
    description: `Created RMA draft for ticket ${ticketId}`,
    userEmail: session.user.email,
    userName: user.name || session.user.email,
    entityType: "rma_order",
    entityId: rmaOrder.id,
    metadata: {
      ticketId,
      rmaOrderId: rmaOrder.id,
      outboundCount: snappedOutbound.length,
      inboundCount: snappedInbound?.length ?? 0,
    },
  });

  return NextResponse.json(rmaOrder, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const ticketId = request.nextUrl.searchParams.get("ticketId");
  if (!ticketId) {
    return NextResponse.json({ error: "ticketId query param is required" }, { status: 400 });
  }

  const orders = await prisma.rmaOrder.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}
```

- [ ] **Step 2: Create GET /api/service/rma/[id]**

`src/app/api/service/rma/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const order = await prisma.rmaOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "RMA order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}
```

- [ ] **Step 3: Create POST /api/service/rma/[id]/create-so**

`src/app/api/service/rma/[id]/create-so/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ZohoSalesOrderPayload } from "@/lib/zoho-inventory";
import {
  resolveZohoWarehouse,
  buildZohoLineItems,
  type RmaLineItem,
} from "@/lib/zoho-so-helpers";
import { resolveCustomer } from "@/lib/bom-customer-resolve";
import { hubspotClient } from "@/lib/hubspot";

async function resolveCustomerFromTicket(
  ticketId: string
): Promise<{ customerId: string | null; dealName: string; primaryContactId: string | null }> {
  let dealName = "";
  let primaryContactId: string | null = null;
  let dealAddress: string | null = null;

  try {
    const ticket = await hubspotClient.crm.tickets.basicApi.getById(
      ticketId,
      [],
      undefined,
      ["deals", "contacts"]
    );

    // Get contact for customer resolution
    const contactIds = (ticket.associations?.contacts?.results || []).map(
      (a: { id: string }) => a.id
    );
    if (contactIds.length > 0) {
      primaryContactId = contactIds[0];
    }

    // Get deal for name-based resolution
    const dealIds = (ticket.associations?.deals?.results || []).map(
      (a: { id: string }) => a.id
    );
    if (dealIds.length > 0) {
      const dealBatch = await hubspotClient.crm.deals.batchApi.read({
        inputs: dealIds.map((id: string) => ({ id })),
        properties: ["dealname", "property_address"],
        propertiesWithHistory: [],
      });
      const deal = dealBatch.results?.[0];
      if (deal) {
        dealName = deal.properties.dealname || "";
        dealAddress = deal.properties.property_address || null;
      }
    }
  } catch (err) {
    console.warn("[rma-create-so] Failed to resolve ticket associations:", err);
  }

  const result = await resolveCustomer({
    dealName,
    primaryContactId,
    dealAddress,
  });

  return {
    customerId: result.customerId,
    dealName,
    primaryContactId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!zohoInventory.isConfigured()) {
    return NextResponse.json({ error: "Zoho Inventory not configured" }, { status: 503 });
  }

  const { id } = await params;
  const rmaOrder = await prisma.rmaOrder.findUnique({ where: { id } });
  if (!rmaOrder) {
    return NextResponse.json({ error: "RMA order not found" }, { status: 404 });
  }
  if (rmaOrder.status !== "DRAFT") {
    return NextResponse.json(
      { error: `RMA order is in ${rmaOrder.status} status, expected DRAFT` },
      { status: 400 }
    );
  }

  // Idempotency guard
  if (rmaOrder.zohoSoId) {
    return NextResponse.json({
      salesorder_id: rmaOrder.zohoSoId,
      salesorder_number: rmaOrder.zohoSoNumber,
      alreadyExisted: true,
    });
  }

  // Parse optional customerId override from body
  let customerIdOverride: string | undefined;
  try {
    const body = await request.json();
    customerIdOverride = body?.customerId;
  } catch {
    // No body or invalid JSON — that's fine, we'll auto-resolve
  }

  // Resolve Zoho customer
  let customerId = customerIdOverride;
  if (!customerId) {
    const resolved = await resolveCustomerFromTicket(rmaOrder.ticketId);
    customerId = resolved.customerId ?? undefined;
  }
  if (!customerId) {
    return NextResponse.json(
      {
        error: "Could not auto-resolve Zoho customer from ticket associations. Provide customerId in the request body.",
        needsCustomerId: true,
      },
      { status: 422 }
    );
  }

  // Build SO payload
  const outboundItems = rmaOrder.outboundItems as unknown as RmaLineItem[];
  const inboundItems = rmaOrder.inboundItems as unknown as RmaLineItem[] | null;
  const warehouseId = resolveZohoWarehouse(rmaOrder.pbLocation);
  const lineItems = buildZohoLineItems(outboundItems, warehouseId);

  const soNumber = `SO-RMA-${rmaOrder.id}`;
  const referenceNumber = `Ticket ${rmaOrder.ticketId} | ${rmaOrder.ticketSubject}`.slice(0, 50);

  const inboundSummary = inboundItems
    ?.map((i) => `${i.brand} ${i.model} x${i.quantity}`)
    .join(", ") ?? "N/A";
  const outboundSummary = outboundItems
    .map((i) => `${i.brand} ${i.model} x${i.quantity}`)
    .join(", ");

  const buildPayload = (includeCustomFields: boolean): ZohoSalesOrderPayload => ({
    customer_id: customerId!,
    salesorder_number: soNumber,
    reference_number: referenceNumber,
    notes: `RMA — Replacing: ${inboundSummary}. Sending: ${outboundSummary}.`,
    status: "draft",
    line_items: lineItems,
    ...(includeCustomFields
      ? {
          custom_fields: [
            { label: "RMA", value: "true" },
            { label: "HubSpot Ticket Record ID", value: rmaOrder.ticketId },
          ],
        }
      : {}),
  });

  let soResult: { salesorder_id: string; salesorder_number: string } | undefined;
  try {
    soResult = await zohoInventory.createSalesOrder(buildPayload(true));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";

    // Custom field fallback
    if (/custom field with the label.*does[\s']?n[o]?[\s']?t exist/i.test(message)) {
      console.warn(
        `[rma-create-so] Zoho missing custom field — retrying without custom fields`
      );
      try {
        soResult = await zohoInventory.createSalesOrder(buildPayload(false));
      } catch (retryErr) {
        return NextResponse.json(
          { error: retryErr instanceof Error ? retryErr.message : "Zoho API error" },
          { status: 500 }
        );
      }
    } else if (message.includes("already exists")) {
      // Crash recovery
      try {
        const existing = await zohoInventory.getSalesOrder(soNumber);
        if (existing?.salesorder_id) {
          await prisma.rmaOrder.update({
            where: { id: rmaOrder.id },
            data: {
              zohoSoId: existing.salesorder_id,
              zohoSoNumber: existing.salesorder_number,
              status: "SO_CREATED",
            },
          });
          return NextResponse.json({
            salesorder_id: existing.salesorder_id,
            salesorder_number: existing.salesorder_number,
            alreadyExisted: true,
          });
        }
      } catch (recoveryErr) {
        console.error("[rma-create-so] Recovery lookup failed:", recoveryErr);
      }
      return NextResponse.json({ error: message }, { status: 500 });
    } else {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!soResult) {
    return NextResponse.json({ error: "Zoho SO creation failed" }, { status: 500 });
  }

  // Update RMA order
  await prisma.rmaOrder.update({
    where: { id: rmaOrder.id },
    data: {
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number,
      status: "SO_CREATED",
    },
  });

  await logActivity({
    type: "RMA_SO_CREATED",
    description: `Created Zoho SO ${soResult.salesorder_number} for RMA on ticket ${rmaOrder.ticketId}`,
    userEmail: session.user.email,
    userName: user.name || session.user.email,
    entityType: "rma_order",
    entityId: rmaOrder.id,
    metadata: {
      ticketId: rmaOrder.ticketId,
      rmaOrderId: rmaOrder.id,
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number,
      itemCount: outboundItems.length,
    },
  });

  return NextResponse.json({
    salesorder_id: soResult.salesorder_id,
    salesorder_number: soResult.salesorder_number,
    alreadyExisted: false,
  });
}
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/service/rma/ src/lib/zoho-so-helpers.ts
git commit -m "feat(rma): add RMA API routes and Zoho SO helpers"
```

---

## Chunk 2: UI Components

### Task 4: RMA Product Picker Component

**Files:**
- Create: `src/components/service/RmaProductPicker.tsx`

- [ ] **Step 1: Create the product picker**

This component provides a search input querying `/api/catalog/search` and displays results as selectable rows. On select, it adds the product with quantity 1 to the item list.

```typescript
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EquipmentCategory } from "@/generated/prisma/enums";

export interface RmaPickerItem {
  productId: string;
  brand: string;
  model: string;
  category: EquipmentCategory;
  quantity: number;
  unitSpecLabel: string | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
}

interface Props {
  items: RmaPickerItem[];
  onItemsChange: (items: RmaPickerItem[]) => void;
  label: string;
}

async function searchCatalog(q: string) {
  const r = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return r.json();
}

const CATEGORY_COLORS: Record<string, string> = {
  MODULE: "bg-yellow-500/20 text-yellow-400",
  INVERTER: "bg-blue-500/20 text-blue-400",
  BATTERY: "bg-green-500/20 text-green-400",
  BATTERY_EXPANSION: "bg-green-500/20 text-green-400",
  EV_CHARGER: "bg-purple-500/20 text-purple-400",
  RACKING: "bg-orange-500/20 text-orange-400",
  ELECTRICAL_BOS: "bg-red-500/20 text-red-400",
  MONITORING: "bg-cyan-500/20 text-cyan-400",
};

export default function RmaProductPicker({ items, onItemsChange, label }: Props) {
  const [query, setQuery] = useState("");

  const { data: results = [] } = useQuery({
    queryKey: ["catalog-search", query],
    queryFn: () => searchCatalog(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });

  const addItem = (product: {
    id: string;
    brand: string;
    model: string;
    category: EquipmentCategory;
    unitSpec: number | null;
    unitLabel: string | null;
    zohoItemId: string | null;
    hubspotProductId: string | null;
  }) => {
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      onItemsChange(
        items.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
    } else {
      const unitSpecLabel =
        product.unitSpec != null && product.unitLabel
          ? `${product.unitSpec}${product.unitLabel}`
          : null;
      onItemsChange([
        ...items,
        {
          productId: product.id,
          brand: product.brand,
          model: product.model,
          category: product.category,
          quantity: 1,
          unitSpecLabel,
          zohoItemId: product.zohoItemId ?? null,
          hubspotProductId: product.hubspotProductId ?? null,
        },
      ]);
    }
    setQuery("");
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty < 1) {
      onItemsChange(items.filter((i) => i.productId !== productId));
    } else {
      onItemsChange(
        items.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i))
      );
    }
  };

  const removeItem = (productId: string) => {
    onItemsChange(items.filter((i) => i.productId !== productId));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        {label}
      </label>

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products by brand, model, or SKU..."
        className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted mb-2"
      />

      {/* Search results */}
      {query.length >= 2 && results.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-t-border bg-surface-2 mb-3">
          {results.map(
            (p: {
              id: string;
              brand: string;
              model: string;
              category: EquipmentCategory;
              unitSpec: number | null;
              unitLabel: string | null;
              zohoItemId: string | null;
              hubspotProductId: string | null;
            }) => (
              <button
                key={p.id}
                onClick={() => addItem(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex items-center gap-2 border-b border-t-border last:border-b-0"
              >
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[p.category] ?? "bg-zinc-500/20 text-zinc-400"}`}
                >
                  {p.category}
                </span>
                <span className="text-foreground">
                  {p.brand} {p.model}
                </span>
                {p.unitSpec != null && p.unitLabel && (
                  <span className="text-muted text-xs">
                    {p.unitSpec}
                    {p.unitLabel}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}

      {/* Selected items */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.productId}
              className="flex items-center gap-3 rounded-lg border border-t-border bg-surface px-3 py-2 text-sm"
            >
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium shrink-0 ${CATEGORY_COLORS[item.category] ?? "bg-zinc-500/20 text-zinc-400"}`}
              >
                {item.category}
              </span>
              <span className="text-foreground flex-1 min-w-0 truncate">
                {item.brand} {item.model}
                {item.unitSpecLabel && (
                  <span className="text-muted ml-1">{item.unitSpecLabel}</span>
                )}
              </span>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) =>
                  updateQuantity(item.productId, parseInt(e.target.value) || 1)
                }
                className="w-16 bg-surface-2 border border-t-border rounded px-2 py-1 text-sm text-foreground text-center"
              />
              <button
                onClick={() => removeItem(item.productId)}
                className="text-muted hover:text-red-400 text-lg leading-none"
                aria-label="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/service/RmaProductPicker.tsx
git commit -m "feat(rma): add RmaProductPicker component"
```

### Task 5: RMA Create Flow Component

**Files:**
- Create: `src/components/service/RmaCreateFlow.tsx`

- [ ] **Step 1: Create the 3-step inline form**

```typescript
"use client";

import { useState } from "react";
import RmaProductPicker, { type RmaPickerItem } from "./RmaProductPicker";

interface Props {
  ticketId: string;
  ticketSubject: string;
  pbLocation: string | null;
  onCreated: () => void;
  onCancel: () => void;
}

type Step = "defective" | "replacement" | "review";

export default function RmaCreateFlow({
  ticketId,
  ticketSubject,
  pbLocation,
  onCreated,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>("defective");
  const [inboundItems, setInboundItems] = useState<RmaPickerItem[]>([]);
  const [outboundItems, setOutboundItems] = useState<RmaPickerItem[]>([]);
  const [location, setLocation] = useState(pbLocation ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDefectiveNext = () => {
    // Pre-populate replacement items with same products
    if (outboundItems.length === 0 && inboundItems.length > 0) {
      setOutboundItems(inboundItems.map((i) => ({ ...i })));
    }
    setStep("replacement");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/service/rma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          ticketSubject,
          outboundItems,
          inboundItems: inboundItems.length > 0 ? inboundItems : undefined,
          pbLocation: location || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save RMA");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-t-border bg-surface-2 p-4 space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={step === "defective" ? "text-cyan-400 font-medium" : ""}>
          1. Defective
        </span>
        <span>&rarr;</span>
        <span className={step === "replacement" ? "text-cyan-400 font-medium" : ""}>
          2. Replacement
        </span>
        <span>&rarr;</span>
        <span className={step === "review" ? "text-cyan-400 font-medium" : ""}>
          3. Review
        </span>
      </div>

      {/* Step 1: Defective items */}
      {step === "defective" && (
        <>
          <RmaProductPicker
            items={inboundItems}
            onItemsChange={setInboundItems}
            label="What's being replaced? (defective items)"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleDefectiveNext}
              disabled={inboundItems.length === 0}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={onCancel}
              className="text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Step 2: Replacement items */}
      {step === "replacement" && (
        <>
          <RmaProductPicker
            items={outboundItems}
            onItemsChange={setOutboundItems}
            label="What's being sent? (replacement items)"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep("review")}
              disabled={outboundItems.length === 0}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={() => setStep("defective")}
              className="text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
          </div>
        </>
      )}

      {/* Step 3: Review */}
      {step === "review" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-muted mb-2">
                Defective (returning)
              </h4>
              <ul className="space-y-1">
                {inboundItems.map((i) => (
                  <li
                    key={i.productId}
                    className="text-sm text-foreground"
                  >
                    {i.brand} {i.model} &times;{i.quantity}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-medium text-muted mb-2">
                Replacement (sending)
              </h4>
              <ul className="space-y-1">
                {outboundItems.map((i) => (
                  <li
                    key={i.productId}
                    className="text-sm text-foreground"
                  >
                    {i.brand} {i.model} &times;{i.quantity}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. DTC, Westminster"
                className="w-full bg-surface border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-surface border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save as Draft"}
            </button>
            <button
              onClick={() => setStep("replacement")}
              className="text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/service/RmaCreateFlow.tsx
git commit -m "feat(rma): add RmaCreateFlow 3-step inline form"
```

### Task 6: RMA Order Card Component

**Files:**
- Create: `src/components/service/RmaOrderCard.tsx`

- [ ] **Step 1: Create the order card**

Displays a single RMA order in DRAFT or SO_CREATED state, with "Create Sales Order" button for drafts.

```typescript
"use client";

import { useState } from "react";
import { getZohoSalesOrderUrl } from "@/lib/external-links";
import type { RmaLineItem } from "@/lib/zoho-so-helpers";

interface RmaOrderData {
  id: string;
  ticketId: string;
  ticketSubject: string;
  status: "DRAFT" | "SO_CREATED" | "RETURN_PENDING" | "CLOSED";
  outboundItems: RmaLineItem[];
  inboundItems: RmaLineItem[] | null;
  zohoSoId: string | null;
  zohoSoNumber: string | null;
  pbLocation: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

interface Props {
  order: RmaOrderData;
  onSoCreated: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-yellow-500/15 text-yellow-400 ring-yellow-500/30",
  SO_CREATED: "bg-green-500/15 text-green-400 ring-green-500/30",
  RETURN_PENDING: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
  CLOSED: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
};

export default function RmaOrderCard({ order, onSoCreated }: Props) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCustomer, setNeedsCustomer] = useState(false);
  const [customerId, setCustomerId] = useState("");

  const handleCreateSo = async (overrideCustomerId?: string) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/service/rma/${order.id}/create-so`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          overrideCustomerId ? { customerId: overrideCustomerId } : {}
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsCustomerId) {
          setNeedsCustomer(true);
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onSoCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create SO");
    } finally {
      setCreating(false);
    }
  };

  const outbound = order.outboundItems ?? [];
  const inbound = order.inboundItems ?? [];

  return (
    <div className="rounded-xl border border-t-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_BADGE[order.status] ?? STATUS_BADGE.CLOSED}`}
        >
          {order.status.replace("_", " ")}
        </span>
        <span className="text-xs text-muted">
          {new Date(order.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Item summaries */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted mb-1">Replacing</div>
          {inbound.length > 0 ? (
            inbound.map((i, idx) => (
              <div key={idx} className="text-foreground">
                {i.brand} {i.model} &times;{i.quantity}
              </div>
            ))
          ) : (
            <div className="text-muted italic">Not specified</div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted mb-1">Sending</div>
          {outbound.map((i, idx) => (
            <div key={idx} className="text-foreground">
              {i.brand} {i.model} &times;{i.quantity}
            </div>
          ))}
        </div>
      </div>

      {order.notes && (
        <div className="text-xs text-muted">{order.notes}</div>
      )}

      {/* Draft actions */}
      {order.status === "DRAFT" && (
        <div className="space-y-2">
          {needsCustomer && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Zoho Customer ID"
                className="flex-1 bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
              />
              <button
                onClick={() => handleCreateSo(customerId)}
                disabled={creating || !customerId.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          )}
          {!needsCustomer && (
            <button
              onClick={() => handleCreateSo()}
              disabled={creating}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? "Creating SO..." : "Create Sales Order"}
            </button>
          )}
          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
      )}

      {/* SO created */}
      {order.status === "SO_CREATED" && order.zohoSoId && (
        <a
          href={getZohoSalesOrderUrl(order.zohoSoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-green-400 hover:text-green-300"
        >
          {order.zohoSoNumber ?? "View SO"} &nearr;
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/service/RmaOrderCard.tsx
git commit -m "feat(rma): add RmaOrderCard component (draft + SO_CREATED states)"
```

### Task 7: RMA Section Container + Wire into Service Ticket Detail

**Files:**
- Create: `src/components/service/RmaSection.tsx`
- Modify: `src/app/dashboards/service-tickets/page.tsx`

- [ ] **Step 1: Create the RMA section container**

```typescript
"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RmaCreateFlow from "./RmaCreateFlow";
import RmaOrderCard from "./RmaOrderCard";

const RMA_ENABLED = process.env.NEXT_PUBLIC_RMA_ENABLED === "true";

interface Props {
  ticketId: string;
  ticketSubject: string;
  pbLocation: string | null;
}

export default function RmaSection({ ticketId, ticketSubject, pbLocation }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["rma-orders", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/service/rma?ticketId=${encodeURIComponent(ticketId)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: RMA_ENABLED,
    staleTime: 30_000,
  });

  if (!RMA_ENABLED) return null;

  const refetchOrders = () => {
    queryClient.invalidateQueries({ queryKey: ["rma-orders", ticketId] });
    setShowCreate(false);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">RMA</h3>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            + Create RMA
          </button>
        )}
      </div>

      {showCreate && (
        <RmaCreateFlow
          ticketId={ticketId}
          ticketSubject={ticketSubject}
          pbLocation={pbLocation}
          onCreated={refetchOrders}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {isLoading && (
        <div className="text-xs text-muted">Loading RMAs...</div>
      )}

      {!isLoading && orders.length === 0 && !showCreate && (
        <div className="text-xs text-muted">No RMAs</div>
      )}

      {orders.length > 0 && (
        <div className="space-y-3 mt-3">
          {orders.map((order: { id: string; [key: string]: unknown }) => (
            <RmaOrderCard
              key={order.id}
              order={order as Parameters<typeof RmaOrderCard>[0]["order"]}
              onSoCreated={refetchOrders}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire RmaSection into service ticket detail**

In `src/app/dashboards/service-tickets/page.tsx`, add the import at the top (after existing imports):

```typescript
import RmaSection from "@/components/service/RmaSection";
```

Then insert the RMA section between the "Add Note" section (ending ~line 649) and the "HubSpot link" (starting ~line 651). The exact insertion point is after the `</div>` that closes the "Add Note" section and before the `<a href={selectedTicket.url}>`:

```tsx
                {/* RMA */}
                <RmaSection
                  ticketId={selectedTicket.id}
                  ticketSubject={selectedTicket.subject}
                  pbLocation={selectedTicket.associations.deals?.[0]?.location ?? null}
                />
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/service/RmaSection.tsx src/app/dashboards/service-tickets/page.tsx
git commit -m "feat(rma): add RmaSection container and wire into service ticket detail"
```

---

## Chunk 3: Build Verification

### Task 8: Build and Type Check

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Fix any build errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(rma): address build/lint issues"
```
