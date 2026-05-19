import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPropertyHub } from "@/lib/property-hub";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { propertyId } = await params;

  try {
    const response = await getPropertyHub(propertyId, "monitoring");
    return NextResponse.json(response.data);
  } catch (err) {
    console.error(
      `[api/powerhub/properties/${propertyId}/sites] error:`,
      err,
    );
    return NextResponse.json(
      { error: "Failed to load monitoring data" },
      { status: 500 },
    );
  }
}
