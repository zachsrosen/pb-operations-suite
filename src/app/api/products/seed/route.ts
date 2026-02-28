import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { createHash } from "crypto";
import { z } from "zod";

export const runtime = "nodejs";

// ── Auth: ADMIN or OWNER only (or API_SECRET_TOKEN for machine clients) ──────
const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);

const ProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  sku: z.string().optional(),
  type: z.string().optional(),
  price: z.number().optional(),
  description: z.string().optional(),
});

const SeedPayloadSchema = z.object({
  products: z.array(ProductSchema).min(1, "At least one product is required").max(2000),
});

const SOURCE = "QUICKBOOKS" as const;

/**
 * Build a canonical, deterministic externalId for products without a SKU.
 * Inputs are trimmed, lowercased, and numeric prices are normalized (no trailing zeros)
 * so that formatting-only differences never create duplicates.
 */
function buildFallbackExternalId(product: z.infer<typeof ProductSchema>): string {
  const canonical = [
    (product.name || "").trim().toLowerCase(),
    (product.type || "").trim().toLowerCase(),
    product.price != null ? Number(product.price).toString() : "",
    (product.description || "").trim().toLowerCase(),
  ].join("|");

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `qb-${hash}`;
}

function canonicalizeSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function resolveExternalId(product: z.infer<typeof ProductSchema>): string {
  const canonical = canonicalizeSku(product.sku || "");
  if (canonical) return canonical;
  return buildFallbackExternalId(product);
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return sku
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    || null;
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Role gate: only ADMIN/OWNER (API_SECRET_TOKEN gets role=ADMIN from api-auth.ts)
  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SeedPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { products } = parsed.data;
  const BATCH_SIZE = 200;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Deduplicate by externalId within the payload (last occurrence wins).
  // Report collisions so the user can clean up the source data.
  const duplicates: Array<{ name: string; externalId: string; occurrences: number }> = [];
  const deduped = new Map<string, z.infer<typeof ProductSchema>>();
  const idCounts = new Map<string, number>();

  for (const product of products) {
    const externalId = resolveExternalId(product);
    deduped.set(externalId, product); // last wins
    idCounts.set(externalId, (idCounts.get(externalId) || 0) + 1);
  }

  for (const [externalId, count] of idCounts) {
    if (count > 1) {
      const product = deduped.get(externalId)!;
      duplicates.push({ name: product.name, externalId, occurrences: count });
    }
  }

  const uniqueProducts = [...deduped.entries()];

  for (let i = 0; i < uniqueProducts.length; i += BATCH_SIZE) {
    const chunk = uniqueProducts.slice(i, i + BATCH_SIZE);

    // Pre-check which externalIds already exist to accurately count inserts vs updates.
    // Safe because: (1) dedup guarantees unique externalIds within the payload,
    // (2) batches execute sequentially (awaited for-loop), and
    // (3) Neon Postgres READ COMMITTED sees prior batch commits.
    const externalIds = chunk.map(([id]) => id);
    const existing = await prisma.catalogProduct.findMany({
      where: {
        source: SOURCE,
        externalId: { in: externalIds },
      },
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((e) => e.externalId));

    // Upsert each product
    const upsertPromises = chunk.map(async ([externalId, product]) => {
      try {
        const name = product.name.trim();
        const sku = (product.sku || "").trim() || null;

        await prisma!.catalogProduct.upsert({
          where: {
            source_externalId: { source: SOURCE, externalId },
          },
          update: {
            name,
            sku,
            normalizedName: normalizeName(name),
            normalizedSku: normalizeSku(sku),
            description: (product.description || "").trim() || null,
            price: product.price ?? null,
            // QB "type" (Service, Non-inventory, etc.) maps to CatalogProduct.status
            status: (product.type || "").trim() || null,
            lastSyncedAt: new Date(),
          },
          create: {
            source: SOURCE,
            externalId,
            name,
            sku,
            normalizedName: normalizeName(name),
            normalizedSku: normalizeSku(sku),
            description: (product.description || "").trim() || null,
            price: product.price ?? null,
            // QB "type" (Service, Non-inventory, etc.) maps to CatalogProduct.status
            status: (product.type || "").trim() || null,
          },
        });

        if (existingSet.has(externalId)) {
          updated++;
        } else {
          inserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Failed to upsert "${product.name}": ${msg}`);
        skipped++;
      }
    });

    await Promise.all(upsertPromises);
  }

  return NextResponse.json({
    source: "quickbooks",
    total: products.length,
    uniqueTotal: uniqueProducts.length,
    inserted,
    updated,
    skipped,
    duplicates: duplicates.length > 0 ? duplicates : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
}
