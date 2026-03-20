import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { buildSnapshots, derivePlan } from "@/lib/catalog-sync-plan";
import type { ExternalSystem, FieldIntent } from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";
import type { SkuRecord } from "@/lib/catalog-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is disabled" }, { status: 404 });
  }

  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const product = await prisma.internalProduct.findUnique({
    where: { id },
    include: SKU_INCLUDE,
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body: { intents: Record<ExternalSystem, Record<string, FieldIntent>> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.intents || typeof body.intents !== "object") {
    return NextResponse.json({ error: "intents is required" }, { status: 400 });
  }

  for (const sys of Object.keys(body.intents)) {
    if (!EXTERNAL_SYSTEMS.includes(sys as ExternalSystem)) {
      return NextResponse.json({ error: `Invalid system: ${sys}` }, { status: 400 });
    }
  }

  const sku = product as unknown as SkuRecord;
  const snapshots = await buildSnapshots(sku, product.category);
  const plan = derivePlan(sku, body.intents, snapshots, product.category);

  return NextResponse.json({ plan });
}
