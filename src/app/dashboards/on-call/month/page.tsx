import DashboardShell from "@/components/DashboardShell";
import { OnCallMonthClient } from "@/components/on-call/OnCallMonthClient";
import { listPools } from "@/lib/on-call-db";

export const dynamic = "force-dynamic";

export default async function OnCallMonthPage() {
  const pools = await listPools();
  return (
    <DashboardShell
      title="On-Call Month View"
      subtitle="Full month calendar with workload distribution"
      accentColor="orange"
    >
      <OnCallMonthClient
        pools={pools.map((p) => ({ id: p.id, name: p.name, region: p.region, timezone: p.timezone }))}
      />
    </DashboardShell>
  );
}
