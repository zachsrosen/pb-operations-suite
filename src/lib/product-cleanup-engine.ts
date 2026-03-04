import { CatalogProductSource } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  CleanupAdapterResult,
  CleanupSource,
} from "@/lib/product-cleanup-adapters";

export type InternalCleanupAction = "none" | "deactivate";
export type LinkCleanupAction = "none" | "unlink_selected";
export type ExternalCleanupAction = "none" | "delete_selected";

export interface ProductCleanupActions {
  internal: InternalCleanupAction;
  links: LinkCleanupAction;
  external: ExternalCleanupAction;
  sources: CleanupSource[];
  deleteCachedProducts?: boolean;
}

export interface CleanupSkuRecord {
  id: string;
  isActive: boolean;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
}

export type CleanupStepStatus =
  | "skipped"
  | "planned"
  | "updated"
  | "partial";

export interface CleanupStepResult {
  status: CleanupStepStatus;
  message: string;
}

export interface CleanupLinkResult extends CleanupStepResult {
  changedFields: string[];
}

export interface CleanupCacheResult extends CleanupStepResult {
  removedCount: number;
}

export interface CleanupInternalEngineResult {
  links: CleanupLinkResult;
  internal: CleanupStepResult;
  cache: CleanupCacheResult;
  updateData: Partial<{
    hubspotProductId: null;
    zuperItemId: null;
    zohoItemId: null;
    isActive: boolean;
  }>;
}

const LINK_FIELD_BY_SOURCE: Record<
  CleanupSource,
  "hubspotProductId" | "zuperItemId" | "zohoItemId"
> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
};

const CACHE_SOURCE_BY_SOURCE: Record<CleanupSource, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
};

export function isExternalResultCacheSafe(result: CleanupAdapterResult | undefined): boolean {
  if (!result) return false;
  return (
    result.status === "deleted" ||
    result.status === "archived" ||
    result.status === "not_found"
  );
}

function trimOrNull(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function buildCleanupUpdatePlan(
  sku: CleanupSkuRecord,
  actions: ProductCleanupActions
): {
  updateData: CleanupInternalEngineResult["updateData"];
  changedLinkFields: string[];
  willDeactivate: boolean;
} {
  const updateData: CleanupInternalEngineResult["updateData"] = {};
  const changedLinkFields: string[] = [];

  if (actions.links === "unlink_selected") {
    for (const source of actions.sources) {
      const field = LINK_FIELD_BY_SOURCE[source];
      if (trimOrNull(sku[field]) === null) continue;
      updateData[field] = null;
      changedLinkFields.push(field);
    }
  }

  const willDeactivate = actions.internal === "deactivate" && sku.isActive;
  if (willDeactivate) {
    updateData.isActive = false;
  }

  return { updateData, changedLinkFields, willDeactivate };
}

export function collectCacheCleanupTargets(
  sku: CleanupSkuRecord,
  actions: ProductCleanupActions,
  externalBySource: Partial<Record<CleanupSource, CleanupAdapterResult>>
): Array<{
  source: CleanupSource;
  catalogSource: CatalogProductSource;
  externalId: string;
}> {
  if (!actions.deleteCachedProducts) return [];
  if (actions.external !== "delete_selected") return [];

  const targets: Array<{
    source: CleanupSource;
    catalogSource: CatalogProductSource;
    externalId: string;
  }> = [];

  for (const source of actions.sources) {
    const field = LINK_FIELD_BY_SOURCE[source];
    const externalId = trimOrNull(sku[field]);
    if (!externalId) continue;
    if (!isExternalResultCacheSafe(externalBySource[source])) continue;
    targets.push({
      source,
      catalogSource: CACHE_SOURCE_BY_SOURCE[source],
      externalId,
    });
  }

  return targets;
}

export async function runInternalCleanupEngine(params: {
  prismaClient: PrismaClient;
  sku: CleanupSkuRecord;
  actions: ProductCleanupActions;
  dryRun?: boolean;
  externalBySource?: Partial<Record<CleanupSource, CleanupAdapterResult>>;
}): Promise<CleanupInternalEngineResult> {
  const {
    prismaClient,
    sku,
    actions,
    dryRun = false,
    externalBySource = {},
  } = params;

  const { updateData, changedLinkFields, willDeactivate } = buildCleanupUpdatePlan(sku, actions);
  const hasInternalUpdate = Object.keys(updateData).length > 0;

  const links: CleanupLinkResult = {
    status:
      actions.links === "unlink_selected"
        ? changedLinkFields.length > 0
          ? dryRun
            ? "planned"
            : "updated"
          : "skipped"
        : "skipped",
    message:
      actions.links === "unlink_selected"
        ? changedLinkFields.length > 0
          ? `${dryRun ? "Will clear" : "Cleared"} ${changedLinkFields.length} linked field${changedLinkFields.length === 1 ? "" : "s"}.`
          : "No selected linked IDs to clear."
        : "Unlink step not selected.",
    changedFields: changedLinkFields,
  };

  const internal: CleanupStepResult = {
    status:
      actions.internal === "deactivate"
        ? willDeactivate
          ? dryRun
            ? "planned"
            : "updated"
          : "skipped"
        : "skipped",
    message:
      actions.internal === "deactivate"
        ? willDeactivate
          ? `${dryRun ? "Will deactivate" : "Deactivated"} internal SKU.`
          : "Internal SKU already inactive."
        : "Internal deactivation not selected.",
  };

  if (!dryRun && hasInternalUpdate) {
    await prismaClient.equipmentSku.update({
      where: { id: sku.id },
      data: updateData,
    });
  }

  const cacheTargets = collectCacheCleanupTargets(sku, actions, externalBySource);
  if (cacheTargets.length === 0) {
    return {
      links,
      internal,
      cache: {
        status: "skipped",
        removedCount: 0,
        message: actions.deleteCachedProducts
          ? "No cache rows qualified for cleanup."
          : "Cache cleanup not selected.",
      },
      updateData,
    };
  }

  if (dryRun) {
    return {
      links,
      internal,
      cache: {
        status: "planned",
        removedCount: 0,
        message: `Will remove cache rows for ${cacheTargets.length} source link${cacheTargets.length === 1 ? "" : "s"}.`,
      },
      updateData,
    };
  }

  let removedCount = 0;
  for (const target of cacheTargets) {
    const removed = await prismaClient.catalogProduct.deleteMany({
      where: {
        source: target.catalogSource,
        externalId: target.externalId,
      },
    });
    removedCount += removed.count;
  }

  return {
    links,
    internal,
    cache: {
      status: removedCount > 0 ? "updated" : "partial",
      removedCount,
      message:
        removedCount > 0
          ? `Removed ${removedCount} cached product row${removedCount === 1 ? "" : "s"}.`
          : "Cache cleanup ran but no rows were removed.",
    },
    updateData,
  };
}

