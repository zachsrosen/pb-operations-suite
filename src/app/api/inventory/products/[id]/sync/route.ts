import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { isCatalogSyncEnabled, validateSyncConfirmationToken, type SyncSystem } from "@/lib/catalog-sync-confirmation";
import { previewSyncToLinkedSystems, computePreviewHash, executeSyncToLinkedSystems } from "@/lib/catalog-sync";
import type { ExcludedFieldsMap, SkuRecord } from "@/lib/catalog-sync";
import { buildSnapshots, deriveDefaultIntents, computeBasePreviewHash } from "@/lib/catalog-sync-plan";
import { getActiveMappings } from "@/lib/catalog-sync-mappings";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);
const VALID_SYSTEMS = new Set<SyncSystem>(["zoho", "hubspot", "zuper"]);

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
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
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
    const previews = await previewSyncToLinkedSystems(sku as Parameters<typeof previewSyncToLinkedSystems>[0]);
    const changesHash = computePreviewHash(previews);

    // New sync relay fields
    const skuRecord = sku as unknown as SkuRecord;
    const snapshots = await buildSnapshots(skuRecord, sku.category);
    const activeMappings = getActiveMappings(sku.category);
    const defaultIntents = deriveDefaultIntents(skuRecord, snapshots, sku.category);
    const basePreviewHash = computeBasePreviewHash(snapshots);

    return NextResponse.json({
      // Legacy fields (keep during migration)
      internalProductId: sku.id,
      previews,
      changesHash,
      systems: previews.map((p) => p.system),
      // New fields
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

  const { token, issuedAt, systems, changesHash: clientHash, excludedFields: rawExcludedFields } = body as {
    token?: string;
    issuedAt?: number;
    systems?: string[];
    changesHash?: string;
    excludedFields?: Record<string, string[]>;
  };

  // Parse and validate excludedFields
  let parsedExcludedFields: ExcludedFieldsMap | undefined;
  if (rawExcludedFields && typeof rawExcludedFields === "object" && !Array.isArray(rawExcludedFields)) {
    parsedExcludedFields = {};
    for (const [sys, fields] of Object.entries(rawExcludedFields)) {
      if (Array.isArray(fields) && fields.every((f) => typeof f === "string")) {
        parsedExcludedFields[sys] = fields;
      }
    }
    if (Object.keys(parsedExcludedFields).length === 0) parsedExcludedFields = undefined;
  }

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Confirmation token is required" }, { status: 400 });
  }
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: "issuedAt is required" }, { status: 400 });
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems array is required" }, { status: 400 });
  }
  if (typeof clientHash !== "string" || !clientHash.trim()) {
    return NextResponse.json({ error: "changesHash is required" }, { status: 400 });
  }

  const validatedSystems = systems.filter((s): s is SyncSystem => VALID_SYSTEMS.has(s as SyncSystem));
  if (validatedSystems.length !== systems.length) {
    return NextResponse.json({ error: "Invalid system in systems array" }, { status: 400 });
  }

  const sku = await prisma.internalProduct.findUnique({
    where: { id },
    include: SKU_INCLUDE,
  });

  if (!sku) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Validate HMAC against the client's hash — proves admin confirmed these changes.
  // The execution layer re-fetches external state and compares hashes to ensure
  // the approved diff hasn't gone stale (returns 409 if it has).
  const validation = validateSyncConfirmationToken({
    token,
    issuedAt,
    internalProductId: id,
    systems: validatedSystems,
    changesHash: clientHash.trim(),
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  try {
    const result = await executeSyncToLinkedSystems(
      sku as Parameters<typeof executeSyncToLinkedSystems>[0],
      clientHash.trim(),
      validatedSystems,
      parsedExcludedFields,
    );

    if (result.stale) {
      return NextResponse.json(
        { error: "External state has changed since preview. Please re-preview and re-approve." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      internalProductId: sku.id,
      outcomes: result.outcomes,
    });
  } catch (error) {
    console.error("[Sync] Execute failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync execution failed" },
      { status: 500 },
    );
  }
}
