import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import {
  buildCleanupConfirmation,
  isProductCleanupEnabled,
  type ProductCleanupActions,
} from "@/lib/product-cleanup-confirmation";
import {
  PRODUCT_CLEANUP_CONFIRM_TTL_MS,
  PRODUCT_CLEANUP_MAX_BATCH,
  dedupeSkuIds,
  productCleanupActionsSchema,
} from "@/lib/schemas/product-cleanup";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { z } from "zod";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

const confirmationRequestSchema = z
  .object({
    internalSkuIds: z.array(z.string().trim().min(1)).min(1).max(PRODUCT_CLEANUP_MAX_BATCH),
    actions: productCleanupActionsSchema,
  })
  .superRefine((value, ctx) => {
    const uniqueSkuIds = new Set(value.internalSkuIds.map((id) => id.trim()));
    if (uniqueSkuIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalSkuIds"],
        message: "At least one internal product ID is required.",
      });
      return;
    }

    if (uniqueSkuIds.size > PRODUCT_CLEANUP_MAX_BATCH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalSkuIds"],
        message: `A maximum of ${PRODUCT_CLEANUP_MAX_BATCH} unique product IDs is allowed per request.`,
      });
    }

    if (value.actions.external === "delete_selected" && value.actions.sources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", "sources"],
        message: "Select at least one source when external cleanup is enabled.",
      });
    }
  });

async function requireCleanupAuth(): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  if (!isProductCleanupEnabled()) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) {
    return { ok: false, response: authResult };
  }

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole)]?.normalizesTo ?? ((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin or owner access required" }, { status: 403 }),
    };
  }

  return { ok: true };
}

export async function GET() {
  const authCheck = await requireCleanupAuth();
  if (!authCheck.ok) return authCheck.response;

  return NextResponse.json({
    enabled: true,
    maxBatch: PRODUCT_CLEANUP_MAX_BATCH,
    ttlMs: PRODUCT_CLEANUP_CONFIRM_TTL_MS,
  });
}

export async function POST(request: NextRequest) {
  const authCheck = await requireCleanupAuth();
  if (!authCheck.ok) return authCheck.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = confirmationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const internalSkuIds = dedupeSkuIds(parsed.data.internalSkuIds);
  if (internalSkuIds.length === 0 || internalSkuIds.length > PRODUCT_CLEANUP_MAX_BATCH) {
    return NextResponse.json(
      {
        error: `Request must include between 1 and ${PRODUCT_CLEANUP_MAX_BATCH} unique product IDs.`,
      },
      { status: 400 }
    );
  }

  try {
    const confirmation = buildCleanupConfirmation({
      internalSkuIds,
      actions: parsed.data.actions as ProductCleanupActions,
    });

    return NextResponse.json(confirmation);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create cleanup confirmation token." },
      { status: 500 }
    );
  }
}
