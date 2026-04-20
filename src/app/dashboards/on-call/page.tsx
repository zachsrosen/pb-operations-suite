import DashboardShell from "@/components/DashboardShell";
import { OnCallDashboardClient } from "@/components/on-call/OnCallDashboardClient";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAdminOnCall } from "@/lib/on-call-auth";

export const dynamic = "force-dynamic";

export default async function OnCallDashboardPage() {
  const user = await getCurrentUser();
  const isAdmin = canAdminOnCall(user);

  return (
    <DashboardShell
      title="On-Call Electricians"
      subtitle="Daily rotation schedule across California, Denver, and Southern CO"
      accentColor="orange"
      headerRight={
        <div className="flex items-center gap-2">
          <Link href="/dashboards/on-call/month"
                className="text-xs px-3 py-1.5 rounded border border-t-border text-muted hover:text-foreground">
            Month View
          </Link>
          {isAdmin && (
            <Link href="/dashboards/on-call/setup"
                  className="text-xs px-3 py-1.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
              Setup
            </Link>
          )}
        </div>
      }
    >
      <OnCallDashboardClient />
    </DashboardShell>
  );
}
