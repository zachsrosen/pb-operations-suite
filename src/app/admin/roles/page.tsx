import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth-utils";
import { ROLES, type RoleDefinition, type Scope } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import DashboardShell from "@/components/DashboardShell";

/**
 * Admin — Role Inspector
 *
 * Read-only view of every role's current access definition. Source of truth is
 * `src/lib/roles.ts` (static code). To modify a role, edit that file and ship a PR.
 *
 * Gated to ADMIN only.
 */
export default async function AdminRoleInspectorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/admin/roles");
  if (!user.roles?.includes("ADMIN")) redirect("/unassigned");

  const roleEntries: Array<[UserRole, RoleDefinition]> = Object.entries(ROLES) as Array<
    [UserRole, RoleDefinition]
  >;

  // Group canonical (visibleInPicker) first, then legacy.
  const canonical = roleEntries.filter(([, def]) => def.visibleInPicker);
  const legacy = roleEntries.filter(([, def]) => !def.visibleInPicker);

  return (
    <DashboardShell title="Role Inspector" accentColor="orange">
      <div className="space-y-6">
        <div className="rounded-lg border border-t-border/60 bg-surface p-4 text-sm">
          <p className="text-foreground">
            Read-only snapshot of every role&apos;s current access. Source of truth: {" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">src/lib/roles.ts</code>
            . To modify a role, edit that file and open a PR.
          </p>
          <p className="mt-2 text-muted">
            Canonical roles are what admins can assign. Legacy roles (OWNER, MANAGER, DESIGNER,
            PERMITTING) exist for pre-migration compat and normalize to their canonical target.
          </p>
        </div>

        <section aria-labelledby="canonical-heading" className="space-y-4">
          <h2 id="canonical-heading" className="text-lg font-semibold text-foreground">
            Canonical roles ({canonical.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {canonical.map(([role, def]) => (
              <RoleCard key={role} role={role} def={def} />
            ))}
          </div>
        </section>

        {legacy.length > 0 && (
          <section aria-labelledby="legacy-heading" className="space-y-4">
            <h2 id="legacy-heading" className="text-lg font-semibold text-foreground">
              Legacy roles ({legacy.length})
            </h2>
            <p className="text-sm text-muted">
              Not assignable via the admin role picker. Any user still carrying one of these
              values has their access resolved via the `normalizesTo` target.
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {legacy.map(([role, def]) => (
                <RoleCard key={role} role={role} def={def} isLegacy />
              ))}
            </div>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}

function RoleCard({
  role,
  def,
  isLegacy = false,
}: {
  role: UserRole;
  def: RoleDefinition;
  isLegacy?: boolean;
}) {
  const badgeClass = badgeClassForColor(def.badge.color);

  return (
    <article className="rounded-lg border border-t-border/60 bg-surface p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-sm font-semibold text-foreground">{role}</h3>
            <span
              className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}
            >
              {def.badge.abbrev}
            </span>
            {isLegacy && (
              <span className="inline-flex rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400">
                Legacy → {def.normalizesTo}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{def.label}</p>
          <p className="mt-0.5 text-xs text-muted">{def.description}</p>
        </div>
      </header>

      <div className="space-y-3 text-sm">
        <KeyValue label="Scope" value={<ScopeBadge scope={def.scope} />} />
        <KeyValue
          label="Normalizes to"
          value={<span className="font-mono text-xs text-foreground">{def.normalizesTo}</span>}
        />
        <KeyValue
          label="Assignable"
          value={
            <span className={def.visibleInPicker ? "text-green-400" : "text-muted"}>
              {def.visibleInPicker ? "Yes (in admin picker)" : "No (legacy)"}
            </span>
          }
        />

        <KeyValue
          label={`Suites (${def.suites.length})`}
          value={
            def.suites.length === 0 ? (
              <span className="text-muted">none</span>
            ) : (
              <ul className="space-y-0.5">
                {def.suites.map((s) => (
                  <li key={s} className="font-mono text-xs">
                    {s}
                  </li>
                ))}
              </ul>
            )
          }
        />

        <KeyValue
          label={`Landing cards (${def.landingCards.length})`}
          value={
            def.landingCards.length === 0 ? (
              <span className="text-muted">none</span>
            ) : (
              <ul className="space-y-1">
                {def.landingCards.map((card) => (
                  <li key={card.href} className="text-xs">
                    <span className="font-medium text-foreground">{card.title}</span>
                    <span className="text-muted"> — </span>
                    <code className="text-muted">{card.href}</code>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <details className="group rounded border border-t-border/60 bg-surface-2 p-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-foreground">
            Allowed routes ({def.allowedRoutes.length})
            <span className="ml-1 text-muted group-open:hidden">— click to expand</span>
          </summary>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
            {def.allowedRoutes.map((r) => (
              <li key={r} className="text-muted">
                {r}
              </li>
            ))}
          </ul>
        </details>

        <details className="group rounded border border-t-border/60 bg-surface-2 p-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-foreground">
            Default capabilities
            <span className="ml-1 text-muted group-open:hidden">— click to expand</span>
          </summary>
          <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {Object.entries(def.defaultCapabilities).map(([key, value]) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="font-mono text-muted">{key}</span>
                <span className={value ? "font-semibold text-green-400" : "text-muted"}>
                  {value ? "true" : "false"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="min-w-0">{value}</div>
    </div>
  );
}

function ScopeBadge({ scope }: { scope: Scope }) {
  const cls =
    scope === "global"
      ? "bg-green-500/10 text-green-400 border-green-500/30"
      : scope === "location"
        ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
        : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {scope}
    </span>
  );
}

function badgeClassForColor(color: string): string {
  // Map the role's `badge.color` family to a Tailwind chip. Mirrors the existing
  // admin UIs' pattern since Tailwind JIT can't expand dynamic class names.
  const lookup: Record<string, string> = {
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    teal: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    zinc: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    slate: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return lookup[color] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
}

// Suppress the unused `Link` import warning — kept for potential future cross-links.
void Link;
