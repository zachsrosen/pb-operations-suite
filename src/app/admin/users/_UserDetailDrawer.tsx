"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import { FormToggle } from "@/components/admin-shell/AdminForm";
import { ROLES as ROLE_DEFS } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

// ── Shared types ─────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roles?: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canScheduleInspections: boolean;
  canSyncToZuper: boolean;
  canManageUsers: boolean;
  canManageAvailability: boolean;
  allowedLocations: string[];
  extraAllowedRoutes?: string[];
  extraDeniedRoutes?: string[];
  hubspotOwnerId?: string | null;
  zuperUserUid?: string | null;
  crewMember?: { id: string; name: string } | null;
}

export interface HubspotOwnerOption {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ZuperUserOption {
  uid: string;
  email: string | null;
  name: string;
}

export interface CrewOption {
  id: string;
  name: string;
  email: string | null;
  linkedUserId: string | null;
}

interface ActivityLog {
  id: string;
  timestamp: string;
  type: string;
  description: string;
}

// ── Role helpers ─────────────────────────────────────────────────────────

const PICKER_ROLES: string[] = (
  Object.entries(ROLE_DEFS) as Array<[string, (typeof ROLE_DEFS)[UserRole]]>
)
  .filter(([, def]) => def.visibleInPicker)
  .map(([role]) => role);

const ROLE_BADGE_BY_COLOR: Record<string, string> = {
  red: "bg-red-500/20 text-red-400 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  teal: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  zinc: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  slate: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  sky: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  violet: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  rose: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  pink: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

const roleLabel = (r: string) => ROLE_DEFS[r as UserRole]?.badge.abbrev ?? r;
const roleDesc = (r: string) => ROLE_DEFS[r as UserRole]?.description ?? "";
const roleBadgeClass = (r: string): string => {
  const color = ROLE_DEFS[r as UserRole]?.badge.color ?? "zinc";
  return ROLE_BADGE_BY_COLOR[color] ?? ROLE_BADGE_BY_COLOR.zinc;
};

const LOCATIONS = [
  "Westminster",
  "Centennial",
  "Pueblo",
  "San Luis Obispo",
  "Camarillo",
];

const PERMISSION_LABELS: Array<{
  key: Exclude<
    keyof Pick<
      AdminUser,
      | "canScheduleSurveys"
      | "canScheduleInstalls"
      | "canScheduleInspections"
      | "canSyncToZuper"
      | "canManageUsers"
      | "canManageAvailability"
    >,
    never
  >;
  label: string;
  help: string;
}> = [
  { key: "canScheduleSurveys", label: "Schedule Surveys", help: "Can schedule site surveys" },
  { key: "canScheduleInstalls", label: "Schedule Installs", help: "Can schedule installations" },
  { key: "canScheduleInspections", label: "Schedule Inspections", help: "Can schedule inspections" },
  { key: "canSyncToZuper", label: "Sync to Zuper", help: "Can sync jobs to Zuper FSM" },
  { key: "canManageUsers", label: "Manage Users", help: "Can access admin panel & manage users" },
  { key: "canManageAvailability", label: "Manage Availability", help: "Can add/edit/remove crew availability" },
];

type TabKey = "overview" | "roles" | "permissions" | "routes" | "integrations" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "roles", label: "Roles" },
  { key: "permissions", label: "Permissions" },
  { key: "routes", label: "Routes" },
  { key: "integrations", label: "Integrations" },
  { key: "activity", label: "Activity" },
];

// ── Component ────────────────────────────────────────────────────────────

export interface UserDetailDrawerProps {
  user: AdminUser | null;
  canImpersonate: boolean; // false if target is self or ADMIN (to match current page)
  saving: boolean;
  onClose: () => void;
  onSaveRoles: (roles: string[]) => Promise<void>;
  onSavePermissions: (perms: {
    canScheduleSurveys: boolean;
    canScheduleInstalls: boolean;
    canScheduleInspections: boolean;
    canSyncToZuper: boolean;
    canManageUsers: boolean;
    canManageAvailability: boolean;
    allowedLocations: string[];
  }) => Promise<void>;
  onSaveRoutes: (
    extraAllowedRoutes: string[],
    extraDeniedRoutes: string[],
  ) => Promise<void>;
  onSaveHubspotOwner: (hubspotOwnerId: string | null) => Promise<void>;
  /** Throws on failure — the drawer surfaces the message inline. */
  onSaveZuperUser: (zuperUserUid: string | null) => Promise<void>;
  /** Throws on failure (409 names the conflicting user) — surfaced inline. */
  onSaveCrewLink: (crewMemberId: string | null, crewName: string | null) => Promise<void>;
  onImpersonate: () => Promise<void>;
}

export default function UserDetailDrawer({
  user,
  canImpersonate,
  saving,
  onClose,
  onSaveRoles,
  onSavePermissions,
  onSaveRoutes,
  onSaveHubspotOwner,
  onSaveZuperUser,
  onSaveCrewLink,
  onImpersonate,
}: UserDetailDrawerProps) {
  const [tab, setTab] = useState<TabKey>("overview");

  // Local edit state — reseeded whenever `user.id` changes.
  const [rolesSel, setRolesSel] = useState<string[]>([]);
  const [perms, setPerms] = useState({
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncToZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    allowedLocations: [] as string[],
  });
  const [extraAllowed, setExtraAllowed] = useState<string[]>([]);
  const [extraDenied, setExtraDenied] = useState<string[]>([]);
  const [hubspotOwnerDraft, setHubspotOwnerDraft] = useState<string>("");
  const [hubspotOwners, setHubspotOwners] = useState<HubspotOwnerOption[] | null>(null);
  const [hubspotOwnersError, setHubspotOwnersError] = useState<string | null>(null);
  const [zuperDraft, setZuperDraft] = useState<string>("");
  const [zuperUsers, setZuperUsers] = useState<ZuperUserOption[] | null>(null);
  const [zuperUsersError, setZuperUsersError] = useState<string | null>(null);
  const [zuperSaveError, setZuperSaveError] = useState<string | null>(null);
  const [crewDraft, setCrewDraft] = useState<string>("");
  const [crewOptions, setCrewOptions] = useState<CrewOption[] | null>(null);
  const [crewOptionsError, setCrewOptionsError] = useState<string | null>(null);
  const [crewSaveError, setCrewSaveError] = useState<string | null>(null);
  const [allowInput, setAllowInput] = useState("");
  const [denyInput, setDenyInput] = useState("");
  const [activity, setActivity] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    if (!user) return;
    setTab("overview");
    setRolesSel(user.roles ?? []);
    setPerms({
      canScheduleSurveys: user.canScheduleSurveys,
      canScheduleInstalls: user.canScheduleInstalls,
      canScheduleInspections: user.canScheduleInspections,
      canSyncToZuper: user.canSyncToZuper,
      canManageUsers: user.canManageUsers,
      canManageAvailability: user.canManageAvailability,
      allowedLocations: user.allowedLocations ?? [],
    });
    setExtraAllowed(user.extraAllowedRoutes ?? []);
    setExtraDenied(user.extraDeniedRoutes ?? []);
    setHubspotOwnerDraft(user.hubspotOwnerId ?? "");
    setZuperDraft(user.zuperUserUid ?? "");
    setCrewDraft(user.crewMember?.id ?? "");
    setZuperSaveError(null);
    setCrewSaveError(null);
    setAllowInput("");
    setDenyInput("");
    setActivity(null);
  }, [user]);

  const loadHubspotOwners = useCallback(async () => {
    if (hubspotOwners !== null) return;
    try {
      const res = await fetch("/api/admin/hubspot-owners");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { owners: HubspotOwnerOption[] };
      setHubspotOwners(data.owners);
      setHubspotOwnersError(null);
    } catch (err) {
      setHubspotOwnersError(err instanceof Error ? err.message : "Failed to load owners");
    }
  }, [hubspotOwners]);

  const loadZuperUsers = useCallback(async () => {
    if (zuperUsers !== null) return;
    try {
      const res = await fetch("/api/admin/zuper-users");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { users: ZuperUserOption[] };
      setZuperUsers(data.users);
      setZuperUsersError(null);
    } catch (err) {
      setZuperUsersError(err instanceof Error ? err.message : "Failed to load Zuper users");
    }
  }, [zuperUsers]);

  const loadCrewOptions = useCallback(async () => {
    if (crewOptions !== null) return;
    try {
      const res = await fetch("/api/admin/crew-options");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { crew: CrewOption[] };
      setCrewOptions(data.crew);
      setCrewOptionsError(null);
    } catch (err) {
      setCrewOptionsError(err instanceof Error ? err.message : "Failed to load crew members");
    }
  }, [crewOptions]);

  // Lazy-load all three pickers' options the first time Integrations opens.
  useEffect(() => {
    if (!user) return;
    if (tab !== "integrations") return;
    loadHubspotOwners();
    loadZuperUsers();
    loadCrewOptions();
  }, [tab, user, loadHubspotOwners, loadZuperUsers, loadCrewOptions]);

  const loadActivity = useCallback(async (userId: string) => {
    try {
      const res = await fetch(
        `/api/admin/activity?userId=${encodeURIComponent(userId)}&limit=10`,
      );
      if (!res.ok) {
        setActivity([]);
        return;
      }
      const data = await res.json();
      setActivity(data.logs ?? []);
    } catch {
      setActivity([]);
    }
  }, []);

  // Lazy-load activity when Activity tab opens.
  useEffect(() => {
    if (!user) return;
    if (tab !== "activity") return;
    if (activity !== null) return;
    loadActivity(user.id);
  }, [tab, user, activity, loadActivity]);

  const open = !!user;
  if (!open || !user) {
    return <AdminDetailDrawer open={false} onClose={onClose} title="" wide>{null}</AdminDetailDrawer>;
  }

  const toggleRole = (role: string) =>
    setRolesSel((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );

  const toggleLocation = (loc: string) =>
    setPerms((p) => ({
      ...p,
      allowedLocations: p.allowedLocations.includes(loc)
        ? p.allowedLocations.filter((l) => l !== loc)
        : [...p.allowedLocations, loc],
    }));

  const addPath = (
    value: string,
    list: string[],
    setList: (next: string[]) => void,
    setInput: (v: string) => void,
  ) => {
    const path = value.trim();
    if (!path || !path.startsWith("/") || list.includes(path)) return;
    setList([...list, path]);
    setInput("");
  };

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {canImpersonate ? (
        <button
          type="button"
          onClick={onImpersonate}
          disabled={saving}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          Impersonate this user
        </button>
      ) : (
        <span className="text-xs text-muted">Impersonation disabled</span>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
        >
          Close
        </button>
        {tab === "roles" && (
          <button
            type="button"
            onClick={() => onSaveRoles(rolesSel)}
            disabled={saving || rolesSel.length === 0}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save roles"}
          </button>
        )}
        {tab === "permissions" && (
          <button
            type="button"
            onClick={() => onSavePermissions(perms)}
            disabled={saving}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save permissions"}
          </button>
        )}
        {tab === "routes" && (
          <button
            type="button"
            onClick={() => onSaveRoutes(extraAllowed, extraDenied)}
            disabled={saving}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save routes"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <AdminDetailDrawer
      open
      onClose={onClose}
      wide
      title={
        <AdminDetailHeader
          title={user.name || user.email}
          subtitle={user.name ? user.email : undefined}
        />
      }
      footer={footer}
    >
      {/* Tab strip */}
      <div className="mb-4 flex gap-1 border-b border-t-border/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-cyan-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          <AdminKeyValueGrid
            items={[
              { label: "Email", value: user.email, mono: true },
              { label: "Name", value: user.name ?? "—" },
              {
                label: "Created",
                value: new Date(user.createdAt).toLocaleString(),
              },
              {
                label: "Last login",
                value: user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString()
                  : "Never",
              },
              {
                label: "Roles",
                value: (
                  <div className="flex flex-wrap gap-1">
                    {(user.roles ?? []).length === 0 ? (
                      <span className="text-xs text-muted">None</span>
                    ) : (
                      (user.roles ?? []).map((r) => (
                        <span
                          key={r}
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(r)}`}
                        >
                          {roleLabel(r)}
                        </span>
                      ))
                    )}
                  </div>
                ),
              },
              {
                label: "Locations",
                value:
                  user.allowedLocations.length === 0
                    ? "All locations"
                    : user.allowedLocations.join(", "),
              },
            ]}
          />
        </div>
      )}

      {/* Roles */}
      {tab === "roles" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Select one or more roles. The user&apos;s effective access is the
            union of every selected role.
          </p>
          {PICKER_ROLES.map((role) => {
            const checked = rolesSel.includes(role);
            return (
              <label
                key={role}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                  checked
                    ? "border-cyan-500/40 bg-cyan-500/10"
                    : "border-t-border/60 bg-surface-2 hover:bg-surface-elevated"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRole(role)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(role)}`}
                  >
                    {roleLabel(role)}
                  </span>
                  <p className="mt-1 text-xs text-muted">{roleDesc(role)}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* Permissions */}
      {tab === "permissions" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Action Permissions
            </h3>
            {PERMISSION_LABELS.map(({ key, label, help }) => (
              <FormToggle
                key={key}
                label={label}
                help={help}
                checked={perms[key]}
                onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
              />
            ))}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Location Access
            </h3>
            <p className="mb-2 text-xs text-muted">
              Empty = access to all locations
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LOCATIONS.map((loc) => {
                const active = perms.allowedLocations.includes(loc);
                return (
                  <label
                    key={loc}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-t-border/60 bg-surface-2 hover:bg-surface-elevated"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleLocation(loc)}
                    />
                    {loc}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Routes (Option D) */}
      {tab === "routes" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Grant or revoke specific paths without changing the role. Paths
            start with &quot;/&quot;. Denials win over grants and override an
            ADMIN wildcard. Changes apply on next sign-in (JWT refresh ≤ 5 min).
          </p>

          <RoutesList
            title={`Extra allowed (${extraAllowed.length})`}
            input={allowInput}
            setInput={setAllowInput}
            placeholder="/dashboards/executive"
            list={extraAllowed}
            onAdd={() =>
              addPath(allowInput, extraAllowed, setExtraAllowed, setAllowInput)
            }
            onRemove={(p) => setExtraAllowed(extraAllowed.filter((x) => x !== p))}
            accent="cyan"
          />

          <RoutesList
            title={`Extra denied (${extraDenied.length})`}
            input={denyInput}
            setInput={setDenyInput}
            placeholder="/dashboards/sensitive-thing"
            list={extraDenied}
            onAdd={() =>
              addPath(denyInput, extraDenied, setExtraDenied, setDenyInput)
            }
            onRemove={(p) => setExtraDenied(extraDenied.filter((x) => x !== p))}
            accent="red"
          />
        </div>
      )}

      {/* Integrations */}
      {tab === "integrations" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Linked accounts</h3>
            <p className="mt-1 text-xs text-muted">
              Explicit links between this PB user and their identities in
              connected systems. Directory sync fills these automatically when
              emails match; set them here when they don&apos;t. Manual links
              are never overwritten by sync.
            </p>
          </div>

          <LinkPicker
            title="HubSpot owner"
            help={`Used by "My Tasks" to pull the right person's tasks when a Google Workspace alias does not match the HubSpot email.`}
            currentSummary={hubspotCurrentSummary(
              user.hubspotOwnerId ?? null,
              hubspotOwners,
            )}
            notLinkedLabel="— Not linked (use email heuristic) —"
            loadingLabel="Loading HubSpot owners…"
            options={
              hubspotOwners?.map((o) => {
                const name = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
                return {
                  value: o.id,
                  label: [name, o.email, `#${o.id}`].filter(Boolean).join(" · "),
                };
              }) ?? null
            }
            optionsError={hubspotOwnersError}
            draft={hubspotOwnerDraft}
            setDraft={setHubspotOwnerDraft}
            currentValue={user.hubspotOwnerId ?? null}
            onSave={onSaveHubspotOwner}
            saving={saving}
            saveError={null}
          />

          <LinkPicker
            title="Zuper user"
            help="Links this PB user to their Zuper field-service account."
            currentSummary={
              user.zuperUserUid
                ? (() => {
                    const zu = zuperUsers?.find((z) => z.uid === user.zuperUserUid);
                    return zu
                      ? [zu.name, zu.email, `#${zu.uid}`].filter(Boolean).join(" · ")
                      : `#${user.zuperUserUid}` +
                          (zuperUsers ? " (user not in Zuper list)" : "");
                  })()
                : "Not linked"
            }
            notLinkedLabel="— Not linked —"
            loadingLabel="Loading Zuper users…"
            options={
              zuperUsers?.map((z) => ({
                value: z.uid,
                label: [z.name, z.email].filter(Boolean).join(" · "),
              })) ?? null
            }
            optionsError={zuperUsersError}
            draft={zuperDraft}
            setDraft={setZuperDraft}
            currentValue={user.zuperUserUid ?? null}
            onSave={async (uid) => {
              setZuperSaveError(null);
              try {
                await onSaveZuperUser(uid);
              } catch (err) {
                setZuperSaveError(
                  err instanceof Error ? err.message : "Failed to save Zuper link",
                );
              }
            }}
            saving={saving}
            saveError={zuperSaveError}
          />

          <LinkPicker
            title="Crew member"
            help="Links this PB user to their field-crew record for scheduling and availability."
            currentSummary={
              user.crewMember ? user.crewMember.name : "Not linked"
            }
            notLinkedLabel="— Not linked —"
            loadingLabel="Loading crew members…"
            options={
              crewOptions?.map((c) => ({
                value: c.id,
                label:
                  [c.name, c.email].filter(Boolean).join(" · ") +
                  (c.linkedUserId && c.linkedUserId !== user.id
                    ? " — linked to another user"
                    : ""),
              })) ?? null
            }
            optionsError={crewOptionsError}
            draft={crewDraft}
            setDraft={setCrewDraft}
            currentValue={user.crewMember?.id ?? null}
            onSave={async (crewMemberId) => {
              setCrewSaveError(null);
              const crewName = crewMemberId
                ? (crewOptions?.find((c) => c.id === crewMemberId)?.name ?? null)
                : null;
              try {
                await onSaveCrewLink(crewMemberId, crewName);
              } catch (err) {
                setCrewSaveError(
                  err instanceof Error ? err.message : "Failed to save crew link",
                );
              }
            }}
            saving={saving}
            saveError={crewSaveError}
          />
        </div>
      )}

      {/* Activity */}
      {tab === "activity" && (
        <div className="space-y-3">
          {activity === null ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-xs text-muted italic">No recent activity.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((log) => (
                <li
                  key={log.id}
                  className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-2 text-xs"
                >
                  <p className="text-foreground/90">{log.description}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {log.type} · {new Date(log.timestamp).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/admin/activity?userId=${encodeURIComponent(user.id)}`}
            className="text-xs text-cyan-400 hover:underline"
          >
            View all →
          </Link>
        </div>
      )}
    </AdminDetailDrawer>
  );
}

// ── Routes list sub-component ────────────────────────────────────────────

interface RoutesListProps {
  title: string;
  input: string;
  setInput: (v: string) => void;
  placeholder: string;
  list: string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
  accent: "cyan" | "red";
}

function RoutesList({
  title,
  input,
  setInput,
  placeholder,
  list,
  onAdd,
  onRemove,
  accent,
}: RoutesListProps) {
  const focusRing =
    accent === "cyan" ? "focus:border-cyan-500" : "focus:border-red-500";
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className={`flex-1 rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none ${focusRing}`}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!input.trim().startsWith("/") || list.includes(input.trim())}
          className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs italic text-muted">None.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs"
            >
              <code className="text-foreground">{path}</code>
              <button
                type="button"
                onClick={() => onRemove(path)}
                aria-label={`Remove ${path}`}
                className="text-muted hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Integrations: linked-account picker ──────────────────────────────────

function hubspotCurrentSummary(
  currentId: string | null,
  owners: HubspotOwnerOption[] | null,
): string {
  const currentOwner = owners?.find((o) => o.id === currentId) ?? null;
  return currentOwner
    ? `${currentOwner.firstName ?? ""} ${currentOwner.lastName ?? ""}`.trim() +
        (currentOwner.email ? ` · ${currentOwner.email}` : "") +
        ` · #${currentOwner.id}`
    : currentId
      ? `#${currentId} (owner not in HubSpot list)`
      : "Not linked — using email heuristic";
}

interface LinkPickerProps {
  title: string;
  help: string;
  currentSummary: string;
  notLinkedLabel: string;
  loadingLabel: string;
  options: Array<{ value: string; label: string }> | null;
  optionsError: string | null;
  draft: string;
  setDraft: (v: string) => void;
  currentValue: string | null;
  onSave: (value: string | null) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

/**
 * One linked-account row: current-link summary box + searchable select +
 * Reset / Save link. Clones the original HubSpot owner picker UX; saving
 * with the "Not linked" option selected unlinks.
 */
function LinkPicker({
  title,
  help,
  currentSummary,
  notLinkedLabel,
  loadingLabel,
  options,
  optionsError,
  draft,
  setDraft,
  currentValue,
  onSave,
  saving,
  saveError,
}: LinkPickerProps) {
  const dirty = (draft || null) !== (currentValue || null);

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {title}
        </h4>
        <p className="mt-1 text-xs text-muted">{help}</p>
      </div>

      <div className="rounded-md border border-t-border/60 bg-surface-2 p-3 text-xs">
        <p className="text-muted">Currently linked</p>
        <p className="mt-1 font-mono text-foreground">{currentSummary}</p>
      </div>

      {optionsError ? (
        <p className="text-xs text-red-400">Error loading options: {optionsError}</p>
      ) : options === null ? (
        <p className="text-xs text-muted">{loadingLabel}</p>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Change to
          </label>
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
          >
            <option value="">{notLinkedLabel}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setDraft(currentValue ?? "")}
              className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-elevated disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => onSave(draft || null)}
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
