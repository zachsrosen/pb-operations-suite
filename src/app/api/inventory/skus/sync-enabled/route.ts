import { NextResponse } from "next/server";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";

export const runtime = "nodejs";

export async function GET() {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ enabled: false }, { status: 404 });
  }
  return NextResponse.json({ enabled: true });
}
