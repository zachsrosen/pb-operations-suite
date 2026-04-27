import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled, validatePlanConfirmationToken } from "@/lib/catalog-sync-confirmation";
import type { SkuRecord } from "@/lib/catalog-sync";
import { buildSnapshots, derivePlan, executePlan, deriveDefaultIntents, computeBasePreviewHash } from "@/lib/catalog-sync-plan";
import type { ExternalSystem, FieldIntent } from "@/lib/catalog-sync-types";
import { getActiveMappings } from "@/lib/catalog-sync-mappings";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

const SKU_INCLUDE = {
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
} as const;

async function authenticate() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return { error: authResult };

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole)]?.normalizesTo ?? ((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return { error: NextResponse.json({ error: "Admin or owner access required" }, { status: 403 }) };
  }
  return { email: authResult.email };
}

// GET: Preview sync changes
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const sku = await prisma.internalProduct.findUnique({
    where: { id },
    include: SKU_INCLUDE,
  });

  if (!sku) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    const skuRecord = sku as unknown as SkuRecord;
    const snapshots = await buildSnapshots(skuRecord, sku.category);
    const activeMappings = getActiveMappings(sku.category);
    const defaultIntents = deriveDefaultIntents(skuRecord, snapshots, sku.category);
    const basePreviewHash = computeBasePreviewHash(snapshots);

    return NextResponse.json({
      internalProductId: sku.id,
      snapshots,
      mappings: activeMappings,
      defaultIntents,
      basePreviewHash,
    });
  } catch (error) {
    console.error("[Sync] Preview failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 },
    );
  }
}

// POST: Execute sync (requires HMAC token)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    token, issuedAt,
    planHash, intents,
  } = body as {
    token?: string;
    issuedAt?: number;
    planHash?: string;
    intents?: Record<ExternalSystem, Record<string, FieldIntent>>;
  };

  if (!planHash || typeof planHash !== "string" || !intents || typeof intents !== "object" || Array.isArray(intents)) {
    return NextResponse.json({ error: "planHash and intents are required" }, { status: 400 });
  }
  if (!token || typeof token !== "string" || typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: "token and issuedAt are required" }, { status: 400 });
  }

  const tokenResult = validatePlanConfirmationToken({
    internalProductId: id,
    planHash,
    issuedAt,
    token,
  });
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.error }, { status: 403 });
  }

  const product = await prisma.internalProduct.findUnique({
    where: { id },
    include: SKU_INCLUDE,
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const sku = product as unknown as SkuRecord;
  const snapshots = await buildSnapshots(sku, product.category);
  const freshPlan = derivePlan(sku, intents, snapshots, product.category);

  // Stale check
  if (freshPlan.planHash !== planHash) {
    return NextResponse.json(
      { error: "External state changed. Re-preview required.", status: "stale" },
      { status: 409 },
    );
  }

  // Conflict check
  if (freshPlan.conflicts.length > 0) {
    return NextResponse.json(
      { error: "Unresolved conflicts", status: "conflict", conflicts: freshPlan.conflicts },
      { status: 409 },
    );
  }

  try {
    const result = await executePlan(sku, freshPlan, { userEmail: auth.email });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Sync] Execute failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync execution failed" },
      { status: 500 },
    );
  }
}
