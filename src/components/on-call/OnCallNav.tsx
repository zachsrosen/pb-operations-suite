import Link from "next/link";

type NavKey = "dashboard" | "me" | "month" | "activity" | "setup";

type Props = {
  current: NavKey;
  /** ADMIN / EXECUTIVE — can edit pools + publish. */
  isAdmin?: boolean;
  /** ADMIN / EXECUTIVE / OPERATIONS_MANAGER — can approve/deny swaps + PTO. */
  isApprover?: boolean;
};

type NavLink = {
  key: NavKey;
  href: string;
  label: string;
  visible?: (p: Required<Omit<Props, "current">>) => boolean;
};

const LINKS: NavLink[] = [
  { key: "dashboard", href: "/dashboards/on-call", label: "Dashboard" },
  { key: "me", href: "/dashboards/on-call/me", label: "My Shifts" },
  { key: "month", href: "/dashboards/on-call/month", label: "Month" },
  {
    key: "activity",
    href: "/dashboards/on-call/activity",
    label: "Activity",
    visible: (p) => p.isApprover || p.isAdmin,
  },
  { key: "setup", href: "/dashboards/on-call/setup", label: "Setup", visible: (p) => p.isAdmin },
];

export function OnCallNav({ current, isAdmin = false, isApprover = false }: Props) {
  const gates = { isAdmin, isApprover: isApprover || isAdmin };
  return (
    <div className="flex items-center gap-1">
      {LINKS.map((link) => {
        if (link.visible && !link.visible(gates)) return null;
        const active = link.key === current;
        return (
          <Link
            key={link.key}
            href={link.href}
            className={
              active
                ? "text-xs px-3 py-1.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30"
                : "text-xs px-3 py-1.5 rounded border border-t-border text-muted hover:text-foreground"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
