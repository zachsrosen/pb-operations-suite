import { NextResponse } from "next/server";

import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";

const MAX_SIZE = 640;

export async function GET(request: Request) {
  const ipHash = hashIp(extractIp(request));
  const allowed = await checkRateLimit(rateLimitKey("static-map", ipHash), 60, 60_000);
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const zoom = Math.min(21, Math.max(10, Number(searchParams.get("zoom") ?? 19)));
  const width = Math.min(MAX_SIZE, Math.max(120, Number(searchParams.get("w") ?? 600)));
  const height = Math.min(MAX_SIZE, Math.max(120, Number(searchParams.get("h") ?? 360)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_STATIC_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Maps key not configured" }, { status: 503 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${width}x${height}`);
  url.searchParams.set("maptype", "satellite");
  url.searchParams.set("markers", `color:red|${lat},${lng}`);
  url.searchParams.set("key", apiKey);

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
  }
  const contentType = upstream.headers.get("content-type") ?? "image/png";
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
