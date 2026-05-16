'use client';

import { useState, type ReactNode } from 'react';
import type { HealthStatus } from '@/lib/shop-health-types';

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

interface SectionCardProps {
  title: string;
  health?: HealthStatus;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function SectionCard({ title, health, children, defaultOpen = true }: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-surface rounded-xl border border-border shadow-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          {health && (
            <span className={`w-2.5 h-2.5 rounded-full ${HEALTH_COLORS[health]}`} />
          )}
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <svg
          className={`w-5 h-5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-6 border-t border-border pt-4">{children}</div>
      )}
    </div>
  );
}
