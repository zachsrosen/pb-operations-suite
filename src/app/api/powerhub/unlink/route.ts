import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { siteId } = await request.json();
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  await prisma.powerhubSite.update({
    where: { siteId },
    data: {
      dealId: null,
      propertyId: null,
      linkMethod: "UNLINKED",
      linkConfidence: "LOW",
    },
  });

  return NextResponse.json({ success: true });
}
