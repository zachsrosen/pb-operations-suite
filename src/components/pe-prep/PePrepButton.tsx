"use client";

import Link from "next/link";

interface Props {
  dealId: string;
  auditStatus?: "ready" | "warned" | "missing" | "never" | null;
  compact?: boolean;
}

const DOT_COLORS = {
  ready: "bg-green-500",
  warned: "bg-yellow-500",
  missing: "bg-red-500",
  never: "bg-gray-400",
} as const;

export function PePrepButton({ dealId, auditStatus, compact }: Props) {
  const dotColor = auditStatus ? DOT_COLORS[auditStatus] : DOT_COLORS.never;

  if (compact) {
    return (
      <Link
        href={`/dashboards/pe-prep/${dealId}`}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-surface-2 hover:bg-surface-elevated text-foreground transition-colors"
        title="Prepare PE Package"
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        Prep
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboards/pe-prep/${dealId}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${auditStatus ? DOT_COLORS[auditStatus] : "bg-white/50"}`} />
      Prepare PE Package
    </Link>
  );
}
