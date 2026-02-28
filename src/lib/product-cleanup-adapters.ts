import { deleteZohoItem } from "@/lib/zoho-inventory";

export const CLEANUP_SOURCES = ["hubspot", "zuper", "zoho", "quickbooks"] as const;
export type CleanupSource = (typeof CLEANUP_SOURCES)[number];

export type CleanupAdapterStatus =
  | "deleted"
  | "archived"
  | "not_found"
  | "failed"
  | "skipped";

export interface CleanupAdapterResult {
  source: CleanupSource;
  externalId: string;
  status: CleanupAdapterStatus;
  message: string;
  httpStatus?: number;
}

type FetchFn = typeof fetch;

const DEFAULT_TIMEOUT_MS = 30_000;
const ZUPER_DEFAULT_API_URL = "https://us-west-1c.zuperpro.com/api";

function trimOrEmpty(value: unknown): string {
  return String(value || "").trim();
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonSafe(raw: string): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return raw;
  }
}

function payloadMessage(payload: unknown): string | null {
  const record = toJsonRecord(payload);
  if (!record) return null;
  const direct = trimOrEmpty(record.message) || trimOrEmpty(record.error);
  if (direct) return direct;
  const fault = toJsonRecord(record.Fault);
  if (fault && Array.isArray(fault.Error) && fault.Error.length > 0) {
    const first = toJsonRecord(fault.Error[0]);
    const detail = trimOrEmpty(first?.Detail) || trimOrEmpty(first?.Message);
    if (detail) return detail;
  }
  return null;
}

function isNotFoundMessage(message: string): boolean {
  return /not[\s_-]*found|does[\s_-]*not[\s_-]*exist|invalid.*id|404/i.test(message);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl: FetchFn = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeoutId);
  }
}

function skipped(source: CleanupSource, externalId: string, message: string): CleanupAdapterResult {
  return { source, externalId, status: "skipped", message };
}

function failed(
  source: CleanupSource,
  externalId: string,
  message: string,
  httpStatus?: number
): CleanupAdapterResult {
  return { source, externalId, status: "failed", message, ...(httpStatus ? { httpStatus } : {}) };
}

function getZuperDeleteEndpoints(): string[] {
  const raw = trimOrEmpty(process.env.ZUPER_DELETE_ENDPOINTS);
  if (raw) {
    const parsed = raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (parsed.length > 0) return [...new Set(parsed)];
  }

  // Conservative defaults across common tenants.
  return [
    "/product/{id}",
    "/products/{id}",
    "/items/{id}",
    "/parts/{id}",
    "/catalog/items/{id}",
    "/catalog/products/{id}",
    "/inventory/items/{id}",
  ];
}

function resolveZuperDeleteEndpoint(endpointTemplate: string, externalId: string): string {
  const withSlash = endpointTemplate.startsWith("/") ? endpointTemplate : `/${endpointTemplate}`;
  if (withSlash.includes("{id}")) {
    return withSlash.replace(/\{id\}/g, encodeURIComponent(externalId));
  }
  return `${withSlash.replace(/\/+$/, "")}/${encodeURIComponent(externalId)}`;
}

export async function archiveHubSpotProduct(
  externalId: string,
  fetchImpl: FetchFn = fetch
): Promise<CleanupAdapterResult> {
  const id = trimOrEmpty(externalId);
  if (!id) return skipped("hubspot", id, "No HubSpot external ID present.");

  const token = trimOrEmpty(process.env.HUBSPOT_ACCESS_TOKEN);
  if (!token) return skipped("hubspot", id, "HUBSPOT_ACCESS_TOKEN is not configured.");

  const response = await fetchWithTimeout(
    `https://api.hubapi.com/crm/v3/objects/products/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    DEFAULT_TIMEOUT_MS,
    fetchImpl
  );

  const raw = await response.text();
  const payload = parseJsonSafe(raw);
  const message = payloadMessage(payload) || raw || `HubSpot product delete status ${response.status}`;

  if (response.ok) {
    return {
      source: "hubspot",
      externalId: id,
      status: "archived",
      message: "HubSpot product archived.",
      httpStatus: response.status,
    };
  }
  if (response.status === 404 || isNotFoundMessage(message)) {
    return {
      source: "hubspot",
      externalId: id,
      status: "not_found",
      message: message || "HubSpot product not found.",
      httpStatus: response.status,
    };
  }

  return failed("hubspot", id, message, response.status);
}

export async function deleteOrArchiveZuperProduct(
  externalId: string,
  fetchImpl: FetchFn = fetch
): Promise<CleanupAdapterResult> {
  const id = trimOrEmpty(externalId);
  if (!id) return skipped("zuper", id, "No Zuper external ID present.");

  const apiKey = trimOrEmpty(process.env.ZUPER_API_KEY);
  if (!apiKey) return skipped("zuper", id, "ZUPER_API_KEY is not configured.");

  const baseUrl = (trimOrEmpty(process.env.ZUPER_API_URL) || ZUPER_DEFAULT_API_URL).replace(/\/+$/, "");
  const endpoints = getZuperDeleteEndpoints();
  const errors: string[] = [];
  let seenNotFound = false;

  for (const endpointTemplate of endpoints) {
    const endpoint = resolveZuperDeleteEndpoint(endpointTemplate, id);
    const url = `${baseUrl}${endpoint}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: "DELETE",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
        },
        DEFAULT_TIMEOUT_MS,
        fetchImpl
      );
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : "request failed"}`);
      continue;
    }

    const raw = await response.text();
    const payload = parseJsonSafe(raw);
    const message = payloadMessage(payload) || raw || `Zuper delete status ${response.status}`;

    if (response.ok) {
      return {
        source: "zuper",
        externalId: id,
        status: "deleted",
        message: "Zuper product deleted.",
        httpStatus: response.status,
      };
    }

    if (response.status === 404 || response.status === 405 || isNotFoundMessage(message)) {
      seenNotFound = true;
      errors.push(`${endpoint}: not found`);
      continue;
    }

    errors.push(`${endpoint}: ${message}`);
  }

  if (seenNotFound) {
    return {
      source: "zuper",
      externalId: id,
      status: "not_found",
      message: "Zuper product not found in configured delete endpoints.",
    };
  }

  return failed(
    "zuper",
    id,
    errors.length > 0 ? `Zuper delete failed. Attempts: ${errors.join(" | ")}` : "Zuper delete failed."
  );
}

export async function deleteOrArchiveZohoItem(
  externalId: string
): Promise<CleanupAdapterResult> {
  const id = trimOrEmpty(externalId);
  if (!id) return skipped("zoho", id, "No Zoho external ID present.");

  const result = await deleteZohoItem(id);
  if (result.status === "deleted") {
    return {
      source: "zoho",
      externalId: id,
      status: "deleted",
      message: result.message || "Zoho item deleted.",
      ...(typeof result.httpStatus === "number" ? { httpStatus: result.httpStatus } : {}),
    };
  }
  if (result.status === "not_found") {
    return {
      source: "zoho",
      externalId: id,
      status: "not_found",
      message: result.message || "Zoho item not found.",
      ...(typeof result.httpStatus === "number" ? { httpStatus: result.httpStatus } : {}),
    };
  }

  return failed("zoho", id, result.message || "Zoho delete failed.", result.httpStatus);
}

async function queryQuickBooksItemById(
  accessToken: string,
  companyId: string,
  externalId: string,
  fetchImpl: FetchFn
): Promise<{ id: string; syncToken: string; active: boolean } | null> {
  const baseUrl = (process.env.QUICKBOOKS_API_BASE_URL || "https://quickbooks.api.intuit.com/v3/company").replace(/\/$/, "");
  const minorVersion = process.env.QUICKBOOKS_MINOR_VERSION || "75";
  const query = `select Id, SyncToken, Active from Item where Id = '${externalId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const url = `${baseUrl}/${encodeURIComponent(companyId)}/query?query=${encodeURIComponent(query)}&minorversion=${encodeURIComponent(minorVersion)}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    DEFAULT_TIMEOUT_MS,
    fetchImpl
  );

  const raw = await response.text();
  const payload = parseJsonSafe(raw);
  if (!response.ok) {
    const message = payloadMessage(payload) || raw || `QuickBooks query failed (${response.status})`;
    if (response.status === 404 || isNotFoundMessage(message)) return null;
    throw new Error(message);
  }

  const root = toJsonRecord(payload);
  const queryResponse = toJsonRecord(root?.QueryResponse);
  const items = Array.isArray(queryResponse?.Item) ? (queryResponse?.Item as unknown[]) : [];
  const first = toJsonRecord(items[0]);
  if (!first) return null;

  const id = trimOrEmpty(first.Id);
  const syncToken = trimOrEmpty(first.SyncToken);
  if (!id || !syncToken) return null;
  const active = first.Active !== false;
  return { id, syncToken, active };
}

export async function archiveQuickBooksItem(
  externalId: string,
  fetchImpl: FetchFn = fetch
): Promise<CleanupAdapterResult> {
  const id = trimOrEmpty(externalId);
  if (!id) return skipped("quickbooks", id, "No QuickBooks external ID present.");

  const accessToken = trimOrEmpty(process.env.QUICKBOOKS_ACCESS_TOKEN);
  const companyId = trimOrEmpty(process.env.QUICKBOOKS_COMPANY_ID);
  if (!accessToken || !companyId) {
    return skipped(
      "quickbooks",
      id,
      "QuickBooks archive requires QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_COMPANY_ID."
    );
  }

  let existing: { id: string; syncToken: string; active: boolean } | null = null;
  try {
    existing = await queryQuickBooksItemById(accessToken, companyId, id, fetchImpl);
  } catch (error) {
    return failed(
      "quickbooks",
      id,
      error instanceof Error ? error.message : "QuickBooks lookup failed."
    );
  }

  if (!existing) {
    return {
      source: "quickbooks",
      externalId: id,
      status: "not_found",
      message: "QuickBooks item not found.",
    };
  }

  if (!existing.active) {
    return {
      source: "quickbooks",
      externalId: id,
      status: "archived",
      message: "QuickBooks item already inactive.",
    };
  }

  const baseUrl = (process.env.QUICKBOOKS_API_BASE_URL || "https://quickbooks.api.intuit.com/v3/company").replace(/\/$/, "");
  const minorVersion = process.env.QUICKBOOKS_MINOR_VERSION || "75";
  const url = `${baseUrl}/${encodeURIComponent(companyId)}/item?operation=update&minorversion=${encodeURIComponent(minorVersion)}`;
  const payload = {
    sparse: true,
    Id: existing.id,
    SyncToken: existing.syncToken,
    Active: false,
  };

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    DEFAULT_TIMEOUT_MS,
    fetchImpl
  );

  const raw = await response.text();
  const responsePayload = parseJsonSafe(raw);
  const message = payloadMessage(responsePayload) || raw || `QuickBooks archive failed (${response.status})`;

  if (response.ok) {
    return {
      source: "quickbooks",
      externalId: id,
      status: "archived",
      message: "QuickBooks item set inactive.",
      httpStatus: response.status,
    };
  }

  if (response.status === 404 || isNotFoundMessage(message)) {
    return {
      source: "quickbooks",
      externalId: id,
      status: "not_found",
      message,
      httpStatus: response.status,
    };
  }

  return failed("quickbooks", id, message, response.status);
}

export async function runCleanupAdapter(
  source: CleanupSource,
  externalId: string
): Promise<CleanupAdapterResult> {
  if (source === "hubspot") return archiveHubSpotProduct(externalId);
  if (source === "zuper") return deleteOrArchiveZuperProduct(externalId);
  if (source === "zoho") return deleteOrArchiveZohoItem(externalId);
  return archiveQuickBooksItem(externalId);
}

