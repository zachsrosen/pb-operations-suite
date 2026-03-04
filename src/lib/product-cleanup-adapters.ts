import { deleteZohoItem } from "@/lib/zoho-inventory";

export const CLEANUP_SOURCES = ["hubspot", "zuper", "zoho"] as const;
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

export async function runCleanupAdapter(
  source: CleanupSource,
  externalId: string
): Promise<CleanupAdapterResult> {
  if (source === "hubspot") return archiveHubSpotProduct(externalId);
  if (source === "zuper") return deleteOrArchiveZuperProduct(externalId);
  if (source === "zoho") return deleteOrArchiveZohoItem(externalId);
  return skipped(source, externalId, `Unknown cleanup source: ${source}`);
}

