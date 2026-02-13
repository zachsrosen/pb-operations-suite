/**
 * Inventory Transactions API — GET & POST
 *
 * GET /api/inventory/transactions
 *   Query params:
 *     - location (string) — filter via stock.location
 *     - type (string) — filter by TransactionType (RECEIVED, ALLOCATED, ADJUSTED, TRANSFERRED, RETURNED)
 *     - limit (number) — max results, default 50, max 200
 *   Returns { transactions, count }
 *
 * POST /api/inventory/transactions
 *   Auth required (ADMIN, OWNER, MANAGER, PROJECT_MANAGER, OPERATIONS, OPERATIONS_MANAGER)
 *   Body: { skuId, location, type, quantity, reason?, projectId?, projectName? }
 *   Atomically upserts stock + creates transaction record + logs activity
 *   Returns { stock, transaction } with status 201
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { TransactionType, ActivityType } from "@/generated/prisma/enums";

// Roles allowed to create transactions
const ALLOWED_ROLES = [
  "ADMIN",
  "OWNER",
  "MANAGER",
  "PROJECT_MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
];

// Map TransactionType to ActivityType for activity logging
const TRANSACTION_ACTIVITY_MAP: Record<TransactionType, ActivityType> = {
  RECEIVED: "INVENTORY_RECEIVED",
  ADJUSTED: "INVENTORY_ADJUSTED",
  ALLOCATED: "INVENTORY_ALLOCATED",
  TRANSFERRED: "INVENTORY_TRANSFERRED",
  RETURNED: "INVENTORY_RECEIVED",
};

// Valid transaction types for validation
const VALID_TYPES = Object.keys(TransactionType) as TransactionType[];

/**
 * GET /api/inventory/transactions — List transactions
 */
export async function GET(request: NextRequest) {
  try {
    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const { searchParams } = request.nextUrl;
    const location = searchParams.get("location");
    const type = searchParams.get("type");
    const limitParam = searchParams.get("limit");

    // Parse and clamp limit
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 200);
      }
    }

    // Build where clause
    const where: Record<string, unknown> = {};

    if (location) {
      where.stock = { location };
    }

    if (type) {
      if (!VALID_TYPES.includes(type as TransactionType)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      where.type = type;
    }

    const transactions = await prisma.stockTransaction.findMany({
      where,
      include: {
        stock: {
          include: { sku: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      transactions,
      count: transactions.length,
    });
  } catch (error) {
    console.error("Failed to fetch transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory/transactions — Create transaction & atomically update stock
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    // Role check
    if (!ALLOWED_ROLES.includes(authResult.role)) {
      return NextResponse.json(
        { error: "Insufficient permissions. Required: ADMIN, OWNER, MANAGER, PROJECT_MANAGER, OPERATIONS, or OPERATIONS_MANAGER" },
        { status: 403 }
      );
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Parse body
    let body: {
      skuId?: string;
      location?: string;
      type?: string;
      quantity?: number;
      reason?: string;
      projectId?: string;
      projectName?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { skuId, location, type, quantity, reason, projectId, projectName } = body;

    // Validate required fields
    if (!skuId) {
      return NextResponse.json({ error: "skuId is required" }, { status: 400 });
    }
    if (!location) {
      return NextResponse.json({ error: "location is required" }, { status: 400 });
    }
    if (!type) {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type as TransactionType)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (quantity === undefined || quantity === null || quantity === 0) {
      return NextResponse.json(
        { error: "quantity is required and must be non-zero" },
        { status: 400 }
      );
    }

    // Sign the quantity based on transaction type
    let signedQty: number;
    switch (type as TransactionType) {
      case "RECEIVED":
      case "RETURNED":
        signedQty = Math.abs(quantity);
        break;
      case "ALLOCATED":
        signedQty = -Math.abs(quantity);
        break;
      case "ADJUSTED":
      case "TRANSFERRED":
        signedQty = quantity;
        break;
      default:
        signedQty = quantity;
    }

    // Atomic transaction: upsert stock + create transaction record
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Upsert InventoryStock
      const stock = await tx.inventoryStock.upsert({
        where: {
          skuId_location: { skuId, location },
        },
        create: {
          skuId,
          location,
          quantityOnHand: signedQty,
          ...(type === "ADJUSTED" ? { lastCountedAt: new Date() } : {}),
        },
        update: {
          quantityOnHand: { increment: signedQty },
          ...(type === "ADJUSTED" ? { lastCountedAt: new Date() } : {}),
        },
        include: { sku: true },
      });

      // Step 2: Create StockTransaction record
      const transaction = await tx.stockTransaction.create({
        data: {
          stockId: stock.id,
          type: type as TransactionType,
          quantity: signedQty,
          reason: reason || null,
          projectId: projectId || null,
          projectName: projectName || null,
          performedBy: authResult.name || authResult.email,
        },
      });

      return { stock, transaction };
    });

    // Activity logging (don't fail the request if this errors)
    try {
      const activityType = TRANSACTION_ACTIVITY_MAP[type as TransactionType];
      const sku = result.stock.sku;
      const description = `${type.toLowerCase()} ${Math.abs(signedQty)}x ${sku.brand} ${sku.model} at ${location}`;

      await logActivity({
        type: activityType,
        description,
        userEmail: authResult.email,
        userName: authResult.name,
        entityType: "inventory",
        entityId: result.stock.id,
        entityName: `${sku.brand} ${sku.model}`,
        pbLocation: location,
        metadata: {
          transactionId: result.transaction.id,
          skuId,
          quantity: signedQty,
          type,
          projectId: projectId || null,
          newOnHand: result.stock.quantityOnHand,
        },
        ipAddress: authResult.ip,
        userAgent: authResult.userAgent,
      });
    } catch (activityError) {
      console.error("Failed to log inventory activity (non-fatal):", activityError);
    }

    return NextResponse.json(
      { stock: result.stock, transaction: result.transaction },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create transaction:", error);
    return NextResponse.json(
      { error: "Failed to create transaction", details: String(error) },
      { status: 500 }
    );
  }
}
