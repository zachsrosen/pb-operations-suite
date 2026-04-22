import DashboardShell from "@/components/DashboardShell";
import { OnCallMeClient } from "@/components/on-call/OnCallMeClient";
import { OnCallNav } from "@/components/on-call/OnCallNav";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAdminOnCall } from "@/lib/on-call-auth";

export const dynamic = "force-dynamic";

export default async function OnCallMePage() {
  const user = await getCurrentUser();
  return (
    <DashboardShell
      title="My On-Call"
      subtitle="Your upcoming shifts and swap inbox"
      accentColor="orange"
      headerRight={<OnCallNav current="me" isAdmin={canAdminOnCall(user)} />}
    >
      <OnCallMeClient />
    </DashboardShell>
  );
}
