/* eslint-disable @typescript-eslint/no-explicit-any -- consumes loosely-typed HubSpot Automation v4 JSON; behavior is guarded by the 855-fixture test suite */
/**
 * HubSpot read client for the Workflow Map feature.
 *
 * Mirrors HubSpot Automation v4 flows + CRM pipelines/properties into a snapshot.
 * All requests go through `fetchWithRetry`, a private wrapper modeled on
 * `searchWithRetry` in `src/lib/hubspot.ts`:
 *   - 429 → exponential backoff + retry (base * 2^attempt + jitter)
 *   - 403/404 → throw immediately (auth/not-found are not transient)
 *   - network error → backoff + retry
 *   - cap at ~5 attempts
 */

// Base backoff delay (ms). Kept low so tests don't sleep for seconds; in prod
// the exponential growth + jitter still clears HubSpot's secondly window.
const BASE_DELAY_MS = 50;
const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authToken(token?: string): string {
  return token ?? process.env.HUBSPOT_ACCESS_TOKEN ?? "";
}

/**
 * GET `url` with Bearer auth and rate-limit retry. Returns parsed JSON.
 * Retries on HTTP 429 and network errors; fails fast on 403/404.
 */
async function fetchWithRetry(url: string, token: string): Promise<any> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        if (attempt < MAX_RETRIES - 1) {
          const base = Math.pow(2, attempt) * BASE_DELAY_MS;
          const jitter = Math.random() * BASE_DELAY_MS;
          await sleep(Math.round(base + jitter));
          continue;
        }
        throw new Error(`HubSpot request failed: 429 (rate limited) for ${url}`);
      }

      // Auth / not-found are not transient — fail immediately.
      if (res.status === 403 || res.status === 404) {
        throw new Error(`HubSpot request failed: ${res.status} for ${url}`);
      }

      if (!res.ok) {
        throw new Error(`HubSpot request failed: ${res.status} for ${url}`);
      }

      return await res.json();
    } catch (error: unknown) {
      // Re-throw non-retryable HTTP errors (403/404/non-429 !ok) immediately.
      const message = error instanceof Error ? error.message : String(error);
      const isHttpError = message.startsWith("HubSpot request failed:");
      const isRateLimit = message.includes("429");

      if (isHttpError && !isRateLimit) {
        throw error;
      }

      // Rate limit (after exhausting retries) or network error: retry if room.
      if (attempt < MAX_RETRIES - 1) {
        const base = Math.pow(2, attempt) * BASE_DELAY_MS;
        const jitter = Math.random() * BASE_DELAY_MS;
        await sleep(Math.round(base + jitter));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * List all Automation v4 flows, paginating via `paging.next.after`.
 */
export async function listFlows(token?: string): Promise<any[]> {
  const t = authToken(token);
  const results: any[] = [];
  let after: string | undefined;

  do {
    let url = "https://api.hubapi.com/automation/v4/flows?limit=100";
    if (after) url += `&after=${after}`;
    const data = await fetchWithRetry(url, t);
    if (Array.isArray(data?.results)) results.push(...data.results);
    after = data?.paging?.next?.after;
  } while (after);

  return results;
}

/**
 * Fetch full detail for a single flow by id.
 */
export async function getFlowDetail(id: string, token?: string): Promise<any> {
  const t = authToken(token);
  return fetchWithRetry(`https://api.hubapi.com/automation/v4/flows/${id}`, t);
}

/**
 * Fetch pipelines for an object type (deals | tickets).
 */
export async function getPipelines(
  objectType: "deals" | "tickets",
  token?: string
): Promise<any[]> {
  const t = authToken(token);
  const data = await fetchWithRetry(
    `https://api.hubapi.com/crm/v3/pipelines/${objectType}`,
    t
  );
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Fetch properties for an object type (deals | tickets).
 */
export async function getProperties(
  objectType: "deals" | "tickets",
  token?: string
): Promise<any[]> {
  const t = authToken(token);
  const data = await fetchWithRetry(
    `https://api.hubapi.com/crm/v3/properties/${objectType}`,
    t
  );
  return Array.isArray(data?.results) ? data.results : [];
}
