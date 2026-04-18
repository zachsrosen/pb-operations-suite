import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import { getRoleCapabilityOverride } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import CapabilityEditor from "./CapabilityEditor";

/**
 * Admin — Role Capability Editor
 *
 * Per-role capability tuning UI. Admin-only. Each capability can be set to
 * inherit (null), force on (true), or force off (false). Route access is not
 * editable here — capabilities only.
 *
 * Source of truth for code defaults: src/lib/roles.ts
 * Source of truth for overrides: RoleCapabilityOverride table
 */
export default async function AdminRoleCapabilitiesPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role: roleParam } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=/admin/roles/${encodeURIComponent(roleParam)}`);
  if (!user.roles?.includes("ADMIN")) redirect("/unassigned");

  const def = ROLES[roleParam as UserRole];
  if (!def) notFound();
  const role = roleParam as UserRole;

  const override = await getRoleCapabilityOverride(role);

  return (
    <div className="space-y-6">
      <AdminPageHeader title={`Role · ${role}`} breadcrumb={["Admin", "People", "Roles", role]} />
      <div className="space-y-6">
        <header className="rounded-lg border border-t-border/60 bg-surface p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{def.label}</h1>
            {!def.visibleInPicker && (
              <span className="inline-flex rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400">
                Legacy → {def.normalizesTo}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">{def.description}</p>
          <p className="mt-3 text-xs text-muted">
            Changes here override the code defaults in{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">src/lib/roles.ts</code>. They
            apply to every user assigned this role. Per-user overrides (on the User table)
            still win over role defaults and these overrides.
          </p>
        </header>

        <CapabilityEditor
          role={role}
          codeDefaults={def.defaultCapabilities}
          initialOverride={override}
        />
      </div>
    </div>
  );
}
