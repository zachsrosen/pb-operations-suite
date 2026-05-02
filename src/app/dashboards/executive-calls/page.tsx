import { redirect } from "next/navigation";

import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";

import CallsClient from "@/app/dashboards/admin/calls/CallsClient";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["ADMIN", "OWNER", "EXECUTIVE"]);

export default async function ExecutiveCallsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/executive-calls");
  if (!user.roles.some((r) => ALLOWED.has(r))) redirect("/");

  const flagEnabled = process.env.AIRCALL_DASHBOARD_ENABLED === "true";
  if (!flagEnabled) {
    return (
      <DashboardShell title="Call Analytics" accentColor="yellow">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          <h2 className="text-lg font-semibold mb-2">Call Analytics is disabled</h2>
          <p className="text-sm text-muted">Toggle <code className="font-mono">AIRCALL_DASHBOARD_ENABLED</code> in production env vars to enable.</p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Call Analytics" accentColor="yellow" fullWidth>
      <CallsClient />
    </DashboardShell>
  );
}
