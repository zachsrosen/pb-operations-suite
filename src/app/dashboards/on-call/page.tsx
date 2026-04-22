import DashboardShell from "@/components/DashboardShell";
import { OnCallDashboardClient } from "@/components/on-call/OnCallDashboardClient";
import { OnCallNav } from "@/components/on-call/OnCallNav";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAdminOnCall, canApproveOnCall } from "@/lib/on-call-auth";

export const dynamic = "force-dynamic";

export default async function OnCallDashboardPage() {
  const user = await getCurrentUser();

  return (
    <DashboardShell
      title="On-Call Electricians"
      subtitle="Weekly rotation schedule across California and Colorado"
      accentColor="orange"
      headerRight={
        <OnCallNav
          current="dashboard"
          isAdmin={canAdminOnCall(user)}
          isApprover={canApproveOnCall(user)}
        />
      }
    >
      <OnCallDashboardClient />
    </DashboardShell>
  );
}
