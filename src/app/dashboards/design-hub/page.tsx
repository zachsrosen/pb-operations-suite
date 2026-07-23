import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { isDesignLead } from "@/lib/design-hub/roster";
import { DesignHubClient } from "./DesignHubClient";

// Flag-read pages must be dynamic — a prerendered shell would 404 once the
// flag flips on (see reference: runtime-flag pages need force-dynamic).
export const dynamic = "force-dynamic";

export default async function DesignHubPage() {
  if (!isDesignHubEnabled()) notFound();
  const session = await auth();
  if (!session?.user) redirect("/");
  const roles = (session.user as { roles?: string[] }).roles ?? [];
  if (!isDesignHubAllowedRole(roles)) notFound();

  const email = session.user.email ?? "";

  return (
    <DashboardShell title="Design Hub" accentColor="purple" fullWidth>
      <DesignHubClient
        userEmail={email}
        // Only roster members have an assignment queue of their own. Everyone
        // else (an admin looking in) still sees both status tabs.
        hasAssignmentQueue={isDesignLead(email)}
      />
    </DashboardShell>
  );
}
