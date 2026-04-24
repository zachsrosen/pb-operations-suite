import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { MapClient } from "./MapClient";

export const dynamic = "force-dynamic";

export default async function JobsMapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabled = process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;

  if (!enabled) {
    return (
      <DashboardShell title="Jobs Map" accentColor="blue">
        <div className="p-8 text-muted">
          The Jobs Map is coming soon. Enable <code>NEXT_PUBLIC_UI_MAP_VIEW_ENABLED</code> to preview.
        </div>
      </DashboardShell>
    );
  }

  // Auto-detect user's home office from allowedLocations[0]. Fail-open to null.
  let userPbLocation: string | null = null;
  try {
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { allowedLocations: true },
    });
    if (dbUser?.allowedLocations?.length) {
      userPbLocation = dbUser.allowedLocations[0];
    }
  } catch {
    // Best-effort — the UI falls back to a picker.
  }

  return (
    <DashboardShell title="Jobs Map" accentColor="blue" fullWidth>
      <MapClient googleMapsApiKey={apiKey} userPbLocation={userPbLocation} />
    </DashboardShell>
  );
}
