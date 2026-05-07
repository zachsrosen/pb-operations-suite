import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAssets, pollTelemetry, pollAlerts } from "@/lib/powerhub-sync";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { type } = await request.json();

  try {
    let result;
    switch (type) {
      case "assets":
        result = await syncAssets();
        break;
      case "telemetry":
        result = await pollTelemetry();
        break;
      case "alerts":
        result = await pollAlerts();
        break;
      default:
        return NextResponse.json(
          { error: "type must be 'assets', 'telemetry', or 'alerts'" },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
