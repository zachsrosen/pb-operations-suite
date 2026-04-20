import DashboardShell from "@/components/DashboardShell";
import { OnCallDashboardClient } from "@/components/on-call/OnCallDashboardClient";
import { OnCallNav } from "@/components/on-call/OnCallNav";
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
      headerRight={<OnCallNav current="dashboard" isAdmin={isAdmin} />}
    >
      <OnCallDashboardClient />
    </DashboardShell>
  );
}
