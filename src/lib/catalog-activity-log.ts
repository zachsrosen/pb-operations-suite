/**
 * Catalog Activity Log
 *
 * Thin wrappers around logActivity for catalog/product sync events.
 * Centralizes the metadata shape so dashboards and digests can rely on it.
 */
import { logActivity } from "@/lib/db";

export type CatalogSyncSource = "wizard" | "bom_pipeline" | "modal" | "bulk" | "approval_retry";

export type SystemName = "INTERNAL" | "HUBSPOT" | "ZOHO" | "ZUPER";

export interface SystemOutcome {
  status: "success" | "failed" | "skipped" | "not_implemented";
  externalId?: string | null;
  message?: string;
}

export interface LogCatalogSyncInput {
  internalProductId: string;
  productName: string;
  userEmail: string;
  userName?: string;
  source: CatalogSyncSource;
  outcomes: Partial<Record<SystemName, SystemOutcome>>;
  durationMs?: number;
  /** Optional: HubSpot deal that triggered this sync, if any */
  dealId?: string;
}

function summarize(outcomes: Partial<Record<SystemName, SystemOutcome>>) {
  const systemsAttempted = Object.keys(outcomes) as SystemName[];
  let successCount = 0, failedCount = 0, skippedCount = 0, notImplementedCount = 0;
  for (const o of Object.values(outcomes)) {
    if (!o) continue;
    if (o.status === "success") successCount++;
    else if (o.status === "failed") failedCount++;
    else if (o.status === "not_implemented") notImplementedCount++;
    else skippedCount++;
  }
  return { systemsAttempted, successCount, failedCount, skippedCount, notImplementedCount };
}

export async function logCatalogSync(input: LogCatalogSyncInput) {
  const summary = summarize(input.outcomes);
  const hasFailure = summary.failedCount > 0;
  return logActivity({
    type: hasFailure ? "CATALOG_SYNC_FAILED" : "CATALOG_SYNC_EXECUTED",
    description: hasFailure
      ? `Catalog sync had ${summary.failedCount} failure(s) for ${input.productName}`
      : `Catalog sync executed for ${input.productName}`,
    userEmail: input.userEmail,
    userName: input.userName,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: input.productName,
    metadata: {
      source: input.source,
      outcomes: input.outcomes,
      ...summary,
      ...(input.dealId ? { dealId: input.dealId } : {}),
    },
    durationMs: input.durationMs,
    riskLevel: hasFailure ? "HIGH" : "LOW",
  });
}

export interface LogCatalogProductCreatedInput {
  internalProductId: string;
  category: string;
  brand: string;
  model: string;
  userEmail: string;
  userName?: string;
  source: CatalogSyncSource;
}

export async function logCatalogProductCreated(input: LogCatalogProductCreatedInput) {
  const productName = `${input.brand} ${input.model}`.trim();
  return logActivity({
    type: "CATALOG_PRODUCT_CREATED",
    description: `New catalog product: ${productName} (${input.category})`,
    userEmail: input.userEmail,
    userName: input.userName,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: productName,
    metadata: {
      category: input.category,
      source: input.source,
    },
    riskLevel: "LOW",
  });
}

export interface LogCatalogProductUpdatedInput {
  internalProductId: string;
  productName: string;
  userEmail: string;
  userName?: string;
  source?: CatalogSyncSource;
  changedFields: string[];
}

export async function logCatalogProductUpdated(input: LogCatalogProductUpdatedInput) {
  return logActivity({
    type: "CATALOG_PRODUCT_UPDATED",
    description: `Updated catalog product ${input.productName}: ${input.changedFields.join(", ")}`,
    userEmail: input.userEmail,
    userName: input.userName,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: input.productName,
    metadata: {
      changedFields: input.changedFields,
      ...(input.source ? { source: input.source } : {}),
    },
    riskLevel: "LOW",
  });
}
