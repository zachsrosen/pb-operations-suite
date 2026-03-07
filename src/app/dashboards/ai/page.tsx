import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessRoute, type UserRole } from "@/lib/role-permissions";
import AISkillsHub from "./AISkillsHub";

const ALLOWED_ROLES = new Set<UserRole>([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "TECH_OPS",
]);

export default async function AISkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/ai");

  if (!ALLOWED_ROLES.has(user.role) || !canAccessRoute(user.role, "/dashboards/ai")) {
    redirect("/");
  }

  return (
    <DashboardShell title="AI Skills" accentColor="purple">
      <AISkillsHub />
    </DashboardShell>
  );
}
