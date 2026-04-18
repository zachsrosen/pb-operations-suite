import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessRoute } from "@/lib/user-access";
import type { UserRole } from "@/generated/prisma/enums";
import AISkillsHub from "./AISkillsHub";

const ALLOWED_ROLES = new Set<UserRole>([
  "ADMIN",
  "EXECUTIVE",
  "MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "TECH_OPS",
]);

export default async function AISkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/ai");

  if (
    !user.roles.some((r) => ALLOWED_ROLES.has(r)) ||
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
