import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { APP_PAGE_ROUTES } from "@/lib/page-directory";
import { canAccessRoute } from "@/lib/user-access";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { DirectoryClient, type DirectoryRow } from "./_DirectoryClient";

const PICKER_ROLES: UserRole[] = (Object.entries(ROLES) as Array<[UserRole, (typeof ROLES)[UserRole]]>)
  .filter(([, def]) => def.visibleInPicker)
  .map(([role]) => role);

function getSection(path: string): string {
  if (path === "/") return "Root";
  if (path.startsWith("/dashboards/")) return "Dashboards";
  if (path.startsWith("/suites/")) return "Suites";
  if (path.startsWith("/admin/")) return "Admin";
  if (path.startsWith("/prototypes/")) return "Prototypes";
  return "Core";
}

function getNotes(path: string): string {
  if (path.includes("[")) return "Dynamic route template";
  if (path.startsWith("/admin/")) return "Admin tooling; downstream APIs may enforce stricter ADMIN-only checks.";
  if (path === "/unassigned") return "Landing page for users without assigned access.";
  return "";
}

export default async function AdminDirectoryPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/admin/directory");

  const user = await getUserByEmail(session.user.email);
  if (!user || !user.roles.includes("ADMIN")) redirect("/");

  const rows: DirectoryRow[] = APP_PAGE_ROUTES.map((path) => ({
    path,
    section: getSection(path),
    notes: getNotes(path),
    allowedRoles: PICKER_ROLES.filter((role) => canAccessRoute(role, path)),
  }));

  const countsByRole = PICKER_ROLES.map((role) => ({
    role,
    count: rows.filter((r) => r.allowedRoles.includes(role)).length,
  }));

  return (
    <div>
      <AdminPageHeader title="Page Directory" breadcrumb={["Admin", "People", "Directory"]} />

      {/* Per-role route counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {countsByRole.map(({ role, count }) => (
          <div key={role} className="bg-surface/50 border border-t-border rounded-lg p-3">
            <div className="text-xs text-muted mb-1">{ROLES[role].badge.abbrev}</div>
            <div className="text-lg font-semibold">{count}</div>
            <div className="text-[11px] text-muted">routes</div>
          </div>
        ))}
      </div>

      <DirectoryClient rows={rows} />
    </div>
  );
}
