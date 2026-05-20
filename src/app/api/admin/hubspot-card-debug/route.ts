// Admin-only debug endpoint to read the last persisted Tesla PowerHub card
// signature-mismatch diagnostic. Allows offline analysis of what canonical
// form HubSpot's hubspot.fetch proxy signs, without needing reliable Vercel
// log streaming.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: "hubspot_card_last_sig_mismatch" },
  });
  if (!row) {
    return NextResponse.json({ status: "empty" });
  }
  let parsed: unknown = row.value;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    /* leave raw */
  }
  return NextResponse.json({
    status: "found",
    updatedAt: row.updatedAt.toISOString(),
    diagnostic: parsed,
  });
}
