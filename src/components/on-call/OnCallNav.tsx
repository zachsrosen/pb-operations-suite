import Link from "next/link";

type Props = {
  current: "dashboard" | "month" | "setup";
  isAdmin?: boolean;
};

type NavLink = {
  key: "dashboard" | "month" | "setup";
  href: string;
  label: string;
  adminOnly?: boolean;
};

const LINKS: NavLink[] = [
  { key: "dashboard", href: "/dashboards/on-call", label: "Dashboard" },
  { key: "month", href: "/dashboards/on-call/month", label: "Month" },
  { key: "setup", href: "/dashboards/on-call/setup", label: "Setup", adminOnly: true },
];

export function OnCallNav({ current, isAdmin = false }: Props) {
  return (
    <div className="flex items-center gap-1">
      {LINKS.map((link) => {
        if (link.adminOnly && !isAdmin) return null;
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
