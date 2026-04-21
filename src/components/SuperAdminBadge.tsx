"use client";

import { useSession } from "next-auth/react";
import { isSuperAdmin } from "@/lib/super-admin";

/**
 * Small amber "SUPER" pill shown next to the role badge in the UserMenu when
 * the signed-in user is a super admin (per `src/lib/super-admin.ts`). Renders
 * nothing for everyone else.
 *
 * The badge is a visibility affordance, not an access gate — the actual break-
 * glass behavior lives in `resolveUserAccess`. This just surfaces "yes, you
 * have the safeguard active" so a super admin doesn't have to wonder whether
 * it's working after a confusing lockout/recovery event.
 */
export function SuperAdminBadge({ className = "" }: { className?: string }) {
  const { data: session } = useSession();
  if (!isSuperAdmin(session?.user?.email)) return null;
  return (
    <span
      title="Break-glass access — you retain full admin regardless of role edits"
      className={`inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        className="h-2.5 w-2.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"
        />
      </svg>
      SUPER
    </span>
  );
}

/**
 * Larger inline note shown in admin-surface chrome (e.g. the /admin/roles
 * drawer when viewing the ADMIN role) to remind a super admin that they
 * cannot lock themselves out. Also renders nothing for non-super admins.
 *
 * Scope-tuned wording: assumes the caller already knows the context (the
 * ADMIN role's override editor) — this is the "phew, nothing to worry
 * about" message, not a general-purpose banner.
 */
export function SuperAdminRoleNote({ className = "" }: { className?: string }) {
  const { data: session } = useSession();
  if (!isSuperAdmin(session?.user?.email)) return null;
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ${className}`}
    >
      <span className="font-semibold">You are the super admin.</span> Even if
      this role&apos;s override is bricked, you retain full access via{" "}
      <code className="rounded bg-amber-500/10 px-1 py-0.5 text-[11px] text-amber-200">
        src/lib/super-admin.ts
      </code>
      . The guards + safeguard mean you cannot lock yourself out of the admin
      surface.
    </div>
  );
}
