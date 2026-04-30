import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessRoute } from "@/lib/user-access";
import AISkillsHub from "./AISkillsHub";

export default async function AISkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/ai");

  if (
    !user.roles.includes("ADMIN") ||
    !user.roles.some((r) => canAccessRoute(r, "/dashboards/ai"))
  ) {
    redirect("/");
  }

  return (
    <DashboardShell title="AI Skills" accentColor="purple">
      <AISkillsHub />
    </DashboardShell>
  );
}
