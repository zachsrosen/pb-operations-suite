import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { OnCallActivityClient } from "@/components/on-call/OnCallActivityClient";
import { OnCallNav } from "@/components/on-call/OnCallNav";
import { getCurrentUser } from "@/lib/auth-utils";
import { canApproveOnCall, canAdminOnCall } from "@/lib/on-call-auth";

export const dynamic = "force-dynamic";

export default async function OnCallActivityPage() {
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) redirect("/dashboards/on-call");
  return (
    <DashboardShell
      title="On-Call Activity"
      subtitle="All swap and PTO requests across every pool"
      accentColor="orange"
      headerRight={<OnCallNav current="activity" isAdmin={canAdminOnCall(user)} isApprover={canApproveOnCall(user)} />}
    >
      <OnCallActivityClient />
    </DashboardShell>
  );
}
