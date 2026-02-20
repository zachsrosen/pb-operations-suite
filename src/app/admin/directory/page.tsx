import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { APP_PAGE_ROUTES } from "@/lib/page-directory";
import { canAccessRoute, type UserRole } from "@/lib/role-permissions";

const ROLES: UserRole[] = [
  "ADMIN",
  "OWNER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "OPERATIONS",
  "TECH_OPS",
  "SALES",
  "VIEWER",
];

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "ADMIN",
  OWNER: "EXECUTIVE",
  OPERATIONS_MANAGER: "OPS MGR",
  PROJECT_MANAGER: "PM",
  OPERATIONS: "OPS",
  TECH_OPS: "TECH OPS",
  SALES: "SALES",
  VIEWER: "UNASSIGNED",
  MANAGER: "PM",
  DESIGNER: "TECH OPS",
  PERMITTING: "TECH OPS",
};

const ROLE_STYLES: Record<UserRole, string> = {
  ADMIN: "bg-red-500/20 text-red-300 border-red-500/30",
  OWNER: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  OPERATIONS_MANAGER: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  PROJECT_MANAGER: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  OPERATIONS: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  TECH_OPS: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  SALES: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  VIEWER: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  MANAGER: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  DESIGNER: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  PERMITTING: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

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
  if (!user || user.role !== "ADMIN") redirect("/");

  const rows = APP_PAGE_ROUTES.map((path) => {
    const allowedRoles = ROLES.filter((role) => canAccessRoute(role, path));
    return {
      path,
      section: getSection(path),
      notes: getNotes(path),
      allowedRoles,
    };
  });

  const countsByRole = ROLES.map((role) => ({
    role,
    count: rows.filter((row) => row.allowedRoles.includes(role)).length,
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/suites/admin" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Admin Suite
          </Link>
          <h1 className="text-2xl font-bold mt-3">Page Directory</h1>
          <p className="text-sm text-muted mt-1">
            All app pages with role-based route access at the middleware level.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {countsByRole.map(({ role, count }) => (
            <div key={role} className="bg-surface/50 border border-t-border rounded-lg p-3">
              <div className="text-xs text-muted mb-1">{ROLE_LABELS[role]}</div>
              <div className="text-lg font-semibold">{count}</div>
              <div className="text-[11px] text-muted">routes</div>
            </div>
          ))}
        </div>

        <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface border-b border-t-border">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold">URL</th>
                  <th className="px-4 py-3 font-semibold">Section</th>
                  <th className="px-4 py-3 font-semibold">Roles</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.path} className="border-b border-t-border/70 align-top">
                    <td className="px-4 py-3 font-mono text-xs">
                      <a
                        href={row.path}
                        className="text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
                      >
                        {`https://www.pbtechops.com${row.path}`}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.section}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {row.allowedRoles.map((role) => (
                          <span
                            key={`${row.path}-${role}`}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded border ${ROLE_STYLES[role]}`}
                          >
                            {ROLE_LABELS[role]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {row.notes || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
