import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { listPools } from "@/lib/on-call-db";
import DashboardShell from "@/components/DashboardShell";
import { OnCallSetupClient } from "@/components/on-call/OnCallSetupClient";

export const dynamic = "force-dynamic";

export default async function OnCallSetupPage() {
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) redirect("/");

  const pools = await listPools();

  return (
    <DashboardShell title="On-Call Setup" subtitle="Configure rotation pools, members, and publishing" accentColor="orange">
      <OnCallSetupClient initialPools={pools} />
    </DashboardShell>
  );
}
