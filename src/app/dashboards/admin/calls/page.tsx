import { redirect } from "next/navigation";

import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";

import CallsClient from "./CallsClient";

export const dynamic = "force-dynamic";

export default async function CallAnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/admin/calls");
  if (!user.roles.includes("ADMIN")) redirect("/");

  const flagEnabled = process.env.AIRCALL_DASHBOARD_ENABLED === "true";

  if (!flagEnabled) {
    return (
      <DashboardShell title="Call Analytics" accentColor="cyan">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          <h2 className="text-lg font-semibold mb-2">Aircall Call Analytics is disabled</h2>
          <p className="text-sm text-muted">
            Set the <code className="font-mono">AIRCALL_DASHBOARD_ENABLED</code> environment variable to <code className="font-mono">true</code>, then redeploy or restart the dev server to enable this dashboard.
          </p>
          <p className="text-sm text-muted mt-2">
            You will also need <code className="font-mono">AIRCALL_API_ID</code>, <code className="font-mono">AIRCALL_API_TOKEN</code>, and <code className="font-mono">AIRCALL_WEBHOOK_TOKEN</code> configured before live data will appear.
          </p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Call Analytics" accentColor="cyan" fullWidth>
      <CallsClient />
    </DashboardShell>
  );
}
