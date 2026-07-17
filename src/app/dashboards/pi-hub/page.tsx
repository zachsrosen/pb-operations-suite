import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import { PiHubClient } from "./PiHubClient";

// Flag-read pages must be dynamic — a prerendered shell would 404 once the
// flag flips on (see reference: runtime-flag pages need force-dynamic).
export const dynamic = "force-dynamic";

export default async function PiHubPage() {
  if (!isPiHubEnabled()) notFound();
  const session = await auth();
  if (!session?.user) redirect("/");
  const roles = (session.user as { roles?: string[] }).roles ?? [];
  if (!isPiHubAllowedRole(roles)) notFound();

  const allowedTeams = allowedTeamsForRoles(roles);

  return (
    <DashboardShell title="P&I Hub" accentColor="blue" fullWidth>
      <PiHubClient
        userEmail={session.user.email ?? ""}
        allowedTeams={allowedTeams}
      />
    </DashboardShell>
  );
}
