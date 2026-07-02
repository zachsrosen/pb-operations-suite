import { redirect } from "next/navigation";

import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";

import TeamActivityClient from "./TeamActivityClient";

export const dynamic = "force-dynamic";

export default async function TeamActivityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/admin/team-activity");
  if (!user.roles.includes("ADMIN")) redirect("/");

  if (process.env.TEAM_ACTIVITY_DASHBOARD_ENABLED !== "true") {
    return (
      <DashboardShell title="Team Activity" accentColor="purple">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          <h2 className="text-lg font-semibold mb-2">Team Activity is disabled</h2>
          <p className="text-sm text-muted">
            Set <code className="font-mono">TEAM_ACTIVITY_DASHBOARD_ENABLED=true</code> and redeploy/restart to enable this dashboard.
          </p>
          <p className="text-sm text-muted mt-2">
            HubSpot activity needs the <code className="font-mono">account-info.security.read</code> scope on the private app;
            Google Workspace activity needs <code className="font-mono">admin.reports.audit.readonly</code> on the service-account
            domain-wide delegation. Missing scopes degrade gracefully (that source is skipped, not fatal).
          </p>
        </div>
      </DashboardShell>
    );
  }

  return <TeamActivityClient />;
}
