"use client";

import { useState } from "react";

/**
 * A titled, collapsible card for laying several information panels out in one
 * view rather than behind tabs — the pattern the IDR design-meeting detail
 * uses (see dashboards/idr-meeting/ProjectDetail.tsx, which has its own local
 * copy; it can adopt this one whenever that file is next touched).
 */
export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t-border bg-surface-2/50 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between p-3"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-muted text-[10px] font-semibold uppercase tracking-wider">
            {title}
          </h3>
          {badge}
        </div>
        <span className="text-muted text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
