import DashboardShell from "@/components/DashboardShell";
import { OnCallMonthClient } from "@/components/on-call/OnCallMonthClient";
import { OnCallNav } from "@/components/on-call/OnCallNav";
import { listPools } from "@/lib/on-call-db";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAdminOnCall, canApproveOnCall } from "@/lib/on-call-auth";

export const dynamic = "force-dynamic";

export default async function OnCallMonthPage() {
  const [pools, user] = await Promise.all([listPools(), getCurrentUser()]);
  return (
    <DashboardShell
      title="On-Call Month View"
      subtitle="Full month calendar with workload distribution"
      accentColor="orange"
      headerRight={<OnCallNav current="month" isAdmin={canAdminOnCall(user)} isApprover={canApproveOnCall(user)} />}
    >
      <OnCallMonthClient
        pools={pools.map((p) => ({ id: p.id, name: p.name, region: p.region, timezone: p.timezone }))}
      />
    </DashboardShell>
  );
}
