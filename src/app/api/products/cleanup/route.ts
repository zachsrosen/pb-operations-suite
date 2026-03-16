import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import { type CleanupAdapterResult, type CleanupSource, runCleanupAdapter } from "@/lib/product-cleanup-adapters";
import {
  isProductCleanupEnabled,
  validateProductCleanupConfirmationToken,
  type ProductCleanupActions,
} from "@/lib/product-cleanup-confirmation";
import { type CleanupSkuRecord, runInternalCleanupEngine } from "@/lib/product-cleanup-engine";
import {
  PRODUCT_CLEANUP_MAX_BATCH,
  dedupeSkuIds,
  productCleanupRequestSchema,
} from "@/lib/schemas/product-cleanup";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

function trim(value: unknown): string {
  return String(value || "").trim();
}

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);

const EXTERNAL_FIELD_BY_SOURCE: Record<
  CleanupSource,
  "hubspotProductId" | "zuperItemId" | "zohoItemId"
> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
};

type ResultStatus = "succeeded" | "partial" | "failed";

interface CleanupResultRow {
  internalSkuId: string;
  status: ResultStatus;
  message: string;
  links: Awaited<ReturnType<typeof runInternalCleanupEngine>>["links"];
  externalBySource: Partial<Record<CleanupSource, CleanupAdapterResult>>;
  internal: Awaited<ReturnType<typeof runInternalCleanupEngine>>["internal"];
  cache: Awaited<ReturnType<typeof runInternalCleanupEngine>>["cache"];
}

function skippedRowDefaults(message: string) {
  return {
    links: { status: "skipped", message, changedFields: [] as string[] },
    internal: { status: "skipped", message },
    cache: { status: "skipped", message, removedCount: 0 },
  } as const;
}

function classifyResultStatus(params: {
  externalBySource: Partial<Record<CleanupSource, CleanupAdapterResult>>;
  linksStatus: CleanupResultRow["links"]["status"];
  internalStatus: CleanupResultRow["internal"]["status"];
  cacheStatus: CleanupResultRow["cache"]["status"];
}): ResultStatus {
  const externalResults = Object.values(params.externalBySource);
  const hasExternalFailure = externalResults.some((result) => result.status === "failed");
  if (!hasExternalFailure) return "succeeded";

  const hasOtherWork =
    params.linksStatus !== "skipped" ||
    params.internalStatus !== "skipped" ||
    params.cacheStatus !== "skipped" ||
    externalResults.some((result) => result.status !== "failed");

  return hasOtherWork ? "partial" : "failed";
}

function summarize(results: CleanupResultRow[]) {
  const summary = {
    total: results.length,
    succeeded: 0,
    partial: 0,
    failed: 0,
  };

  for (const result of results) {
    if (result.status === "succeeded") summary.succeeded += 1;
    else if (result.status === "partial") summary.partial += 1;
    else summary.failed += 1;
  }

  return summary;
}

export async function POST(request: NextRequest) {
  if (!isProductCleanupEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = productCleanupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const internalSkuIds = dedupeSkuIds(payload.internalSkuIds);
  if (internalSkuIds.length === 0 || internalSkuIds.length > PRODUCT_CLEANUP_MAX_BATCH) {
    return NextResponse.json(
      {
        error: `Request must include between 1 and ${PRODUCT_CLEANUP_MAX_BATCH} unique SKU IDs.`,
      },
      { status: 400 }
    );
  }

  const confirmationCheck = validateProductCleanupConfirmationToken({
    token: payload.confirmation.token,
    issuedAt: payload.confirmation.issuedAt,
    internalSkuIds,
    actions: payload.actions as ProductCleanupActions,
  });

  if (!confirmationCheck.ok) {
    return NextResponse.json({ error: confirmationCheck.error }, { status: 400 });
  }

  try {
    const skuRows = await prisma.internalProduct.findMany({
      where: { id: { in: internalSkuIds } },
      select: {
        id: true,
        isActive: true,
        hubspotProductId: true,
        zuperItemId: true,
        zohoItemId: true,
      },
    });

    const skuById = new Map<string, CleanupSkuRecord>(
      skuRows.map((row) => [row.id, row as CleanupSkuRecord])
    );

    const results: CleanupResultRow[] = [];

    for (const internalSkuId of internalSkuIds) {
      const sku = skuById.get(internalSkuId);
      if (!sku) {
        const message = "Internal SKU not found.";
        const skipped = skippedRowDefaults(message);
        results.push({
          internalSkuId,
          status: "failed",
          message,
          externalBySource: {},
          links: skipped.links,
          internal: skipped.internal,
          cache: skipped.cache,
        });
        continue;
      }

      const externalBySource: Partial<Record<CleanupSource, CleanupAdapterResult>> = {};

      if (payload.actions.external === "delete_selected" && payload.actions.sources.length > 0) {
        const externalResults = await Promise.all(
          payload.actions.sources.map(async (source): Promise<[CleanupSource, CleanupAdapterResult]> => {
            const field = EXTERNAL_FIELD_BY_SOURCE[source];
            const externalId = trim(sku[field]);

            if (!externalId) {
              return [
                source,
                {
                  source,
                  externalId: "",
                  status: "skipped",
                  message: `No ${source} link on internal SKU.`,
                },
              ];
            }

            if (payload.dryRun) {
              return [
                source,
                {
                  source,
                  externalId,
                  status: "skipped",
                  message: `Dry run: external cleanup for ${source} not executed.`,
                },
              ];
            }

            try {
              const result = await runCleanupAdapter(source, externalId);
              return [source, result];
            } catch (error) {
              return [
                source,
                {
                  source,
                  externalId,
                  status: "failed",
                  message: error instanceof Error ? error.message : `External cleanup failed for ${source}.`,
                },
              ];
            }
          })
        );

        for (const [source, externalResult] of externalResults) {
          externalBySource[source] = externalResult;
        }
      }

      const internalEngineResult = await runInternalCleanupEngine({
        prismaClient: prisma,
        sku,
        actions: payload.actions,
        dryRun: payload.dryRun,
        externalBySource,
      });

      const status = classifyResultStatus({
        externalBySource,
        linksStatus: internalEngineResult.links.status,
        internalStatus: internalEngineResult.internal.status,
        cacheStatus: internalEngineResult.cache.status,
      });

      const message =
        status === "failed"
          ? "Cleanup failed for one or more selected sources."
          : status === "partial"
            ? "Cleanup completed with partial failures."
            : "Cleanup completed.";

      results.push({
        internalSkuId,
        status,
        message,
        externalBySource,
        links: internalEngineResult.links,
        internal: internalEngineResult.internal,
        cache: internalEngineResult.cache,
      });
    }

    const summary = summarize(results);

    await logActivity({
      type: "FEATURE_USED",
      description: `${payload.dryRun ? "Dry-run" : "Executed"} product cleanup for ${internalSkuIds.length} SKU${internalSkuIds.length === 1 ? "" : "s"}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "product_cleanup",
      entityId: internalSkuIds.join(","),
      metadata: {
        dryRun: payload.dryRun,
        skuCount: internalSkuIds.length,
        actions: payload.actions,
        summary,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: request.nextUrl.pathname,
      requestMethod: request.method,
      responseStatus: 200,
    });

    return NextResponse.json({
      dryRun: payload.dryRun,
      summary,
      results,
    });
  } catch (error) {
    console.error("Product cleanup route failed:", error);
    return NextResponse.json({ error: "Failed to run product cleanup." }, { status: 500 });
  }
}
