import * as Sentry from "@sentry/nextjs";

// ── Types ──

export interface EagleViewOrthoImage {
  image_urn: string;
  capture_date: string;
  gsd: number;
  [key: string]: unknown;
}

export interface RankLocationResponse {
  ortho: { images: EagleViewOrthoImage[] };
  oblique: { images: unknown[] };
}

export interface ImageAtLocationResult {
  buffer: ArrayBuffer;
  contentType: string;
}

export interface BestOrthoResult {
  imageUrn: string;
  captureDate: string | null;
  gsd: number | null;
}

export interface GetImageOptions {
  radius?: number;
  format?: "png" | "jpg";
  zoom?: number;
  size?: { width: number; height: number };
  quality?: number;
}

// ── Constants ──

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

function getBaseUrl(): string {
  return process.env.EAGLEVIEW_SANDBOX === "true"
    ? "https://sandbox.apis.eagleview.com"
    : "https://apis.eagleview.com";
}

function getApiKey(): string {
  const key = process.env.EAGLEVIEW_API_KEY;
  if (!key) throw new Error("EAGLEVIEW_API_KEY environment variable is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitDelay(attempt: number): number {
  const base = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

// ── Client ──

class EagleViewClient {
  private async request<T>(
    path: string,
    options: RequestInit & { parseJson?: boolean } = {},
  ): Promise<T> {
    const { parseJson = true, ...fetchOptions } = options;
    const url = `${getBaseUrl()}${path}`;

    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${getApiKey()}`,
            "Content-Type": "application/json",
            ...fetchOptions.headers,
          },
          cache: "no-store",
        });

        // Immediate fail on auth/not-found errors
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          const body = await response.text().catch(() => "");
          throw new Error(`EagleView ${response.status}: ${body.slice(0, 200)}`);
        }

        // Retry on rate limit
        if (response.status === 429) {
          if (attempt < RATE_LIMIT_MAX_RETRIES) {
            const delay = rateLimitDelay(attempt);
            Sentry.addBreadcrumb({
              category: "eagleview",
              message: `Rate limited (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}), retrying in ${Math.round(delay)}ms`,
              level: "warning",
            });
            await sleep(delay);
            continue;
          }
          throw new Error("EagleView rate limit exceeded after max retries");
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`EagleView ${response.status}: ${body.slice(0, 200)}`);
        }

        if (parseJson) {
          return (await response.json()) as T;
        }
        return response as unknown as T;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(`EagleView request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        // Only retry rate limit errors
        if (attempt < RATE_LIMIT_MAX_RETRIES && err instanceof Error && err.message.includes("rate limit")) {
          continue;
        }
        Sentry.captureException(err);
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("EagleView request failed after max retries");
  }

  /** Discover available ortho + oblique images at a location. */
  async rankLocation(lat: number, lng: number, radius = 50): Promise<RankLocationResponse> {
    return this.request<RankLocationResponse>("/imagery/v3/discovery/rank/location", {
      method: "POST",
      body: JSON.stringify({
        center: { x: lng, y: lat, radius },
        view: {
          ortho: {},
          oblique: {
            cardinals: { north: true, south: true, east: true, west: true },
          },
        },
      }),
    });
  }

  /** Download image bytes for a specific image URN at a location. */
  async getImageAtLocation(
    imageUrn: string,
    lat: number,
    lng: number,
    options: GetImageOptions = {},
  ): Promise<ImageAtLocationResult> {
    const params = new URLSearchParams();
    params.set("center.x", String(lng));
    params.set("center.y", String(lat));
    params.set("center.radius", String(options.radius ?? 50));
    if (options.format) params.set("format", options.format);
    if (options.zoom) params.set("zoom", String(options.zoom));
    if (options.size) {
      params.set("size.width", String(options.size.width));
      params.set("size.height", String(options.size.height));
    }
    if (options.quality) params.set("quality", String(options.quality));

    const encodedUrn = encodeURIComponent(imageUrn);
    const response = await this.request<Response>(
      `/imagery/v3/images/${encodedUrn}/location?${params}`,
      { method: "GET", parseJson: false },
    );

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "image/png";
    return { buffer, contentType };
  }

  /**
   * Convenience: discover images at a location and pick the best ortho.
   * Selection: lowest GSD (highest resolution), then most recent capture date.
   * Returns null if no ortho images are available.
   */
  async getBestOrthoForLocation(lat: number, lng: number): Promise<BestOrthoResult | null> {
    const discovery = await this.rankLocation(lat, lng);
    const images = discovery.ortho?.images ?? [];
    if (images.length === 0) return null;

    const sorted = [...images].sort((a, b) => {
      // Lower GSD = higher resolution = better
      const gsdDiff = (a.gsd ?? Infinity) - (b.gsd ?? Infinity);
      if (gsdDiff !== 0) return gsdDiff;
      // Same GSD → prefer more recent
      return (b.capture_date ?? "").localeCompare(a.capture_date ?? "");
    });

    const best = sorted[0];
    return {
      imageUrn: best.image_urn,
      captureDate: best.capture_date ?? null,
      gsd: best.gsd ?? null,
    };
  }
}

export const eagleView = new EagleViewClient();
