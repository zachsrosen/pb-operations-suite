// src/components/admin-shell/nav.ts
//
// Single source of truth for the admin sidebar. Any new admin page added
// later should be registered here AND have its `/admin/<path>` route exist.

export interface AdminNavItem {
  label: string;
  href: string;
  /** Lucide icon name or a local symbol; resolved by the sidebar. */
  iconName: "users" | "shield" | "list" | "calendar" | "ticket" | "activity" | "eye" | "alert";
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "People",
    items: [
      { label: "Users", href: "/admin/users", iconName: "users" },
      { label: "Roles", href: "/admin/roles", iconName: "shield" },
      { label: "Directory", href: "/admin/directory", iconName: "list" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Crew availability", href: "/admin/crew-availability", iconName: "calendar" },
      { label: "Tickets", href: "/admin/tickets", iconName: "ticket" },
    ],
  },
  {
    label: "Audit",
    items: [
      { label: "Activity log", href: "/admin/activity", iconName: "activity" },
      { label: "Audit sessions", href: "/admin/audit", iconName: "eye" },
      { label: "Security alerts", href: "/admin/security", iconName: "alert" },
    ],
  },
];

/**
 * Given the current pathname, return the ADMIN_NAV item whose href is the
 * best match (exact or longest prefix). Used by the sidebar to highlight
 * the active link and by the breadcrumb to name the current section.
 */
export function findActiveAdminNavItem(pathname: string): { group: AdminNavGroup; item: AdminNavItem } | null {
  let bestMatch: { group: AdminNavGroup; item: AdminNavItem; length: number } | null = null;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!bestMatch || item.href.length > bestMatch.length) {
          bestMatch = { group, item, length: item.href.length };
        }
      }
    }
  }
  if (!bestMatch) return null;
  const { group, item } = bestMatch;
  return { group, item };
}
