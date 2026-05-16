'use client';

import { useState, useCallback, useRef } from 'react';
import { useBottleneckMutation } from '@/hooks/useShopHealthData';
import {
  BOTTLENECK_DIAGNOSTICS,
  type ShopHealthBottleneckEntry,
} from '@/lib/shop-health-types';
import { getWeekStart } from '@/lib/shop-health';

interface BottleneckSectionProps {
  location: string;
  weekStart: string;
  bottleneck: ShopHealthBottleneckEntry | null;
}

const AUTOSAVE_DELAY = 1500;

export function BottleneckSectionContent({
  location,
  weekStart,
  bottleneck,
}: BottleneckSectionProps) {
  const [constraint, setConstraint] = useState(bottleneck?.constraint ?? '');
  const [rootCause, setRootCause] = useState(bottleneck?.rootCause ?? '');
  const [actionPlan, setActionPlan] = useState(bottleneck?.actionPlan ?? '');
  const [owner, setOwner] = useState(bottleneck?.owner ?? '');
  const [saved, setSaved] = useState(false);

  const mutation = useBottleneckMutation(location, weekStart);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine if this is a past week (read-only)
  const currentWeek = getWeekStart(new Date());
  const weekDate = new Date(weekStart + 'T00:00:00');
  const isPastWeek = weekDate.getTime() < currentWeek.getTime();

  const autoSave = useCallback(
    (fields: { constraint: string; rootCause: string; actionPlan: string; owner: string }) => {
      if (isPastWeek) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        mutation.mutate(
          {
            location,
            weekStart,
            constraint: fields.constraint || null,
            rootCause: fields.rootCause || null,
            actionPlan: fields.actionPlan || null,
            owner: fields.owner || null,
          },
          {
            onSuccess: () => {
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            },
          }
        );
      }, AUTOSAVE_DELAY);
    },
    [location, weekStart, isPastWeek, mutation]
  );

  function handleChange(
    field: 'constraint' | 'rootCause' | 'actionPlan' | 'owner',
    value: string
  ) {
    const next = { constraint, rootCause, actionPlan, owner, [field]: value };
    if (field === 'constraint') setConstraint(value);
    if (field === 'rootCause') setRootCause(value);
    if (field === 'actionPlan') setActionPlan(value);
    if (field === 'owner') setOwner(value);
    autoSave(next);
  }

  const inputClass =
    'w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-foreground text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Primary Constraint
          </label>
          <input
            type="text"
            className={inputClass}
            value={constraint}
            onChange={(e) => handleChange('constraint', e.target.value)}
            placeholder="What is the #1 bottleneck this week?"
            disabled={isPastWeek}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Root Cause
          </label>
          <input
            type="text"
            className={inputClass}
            value={rootCause}
            onChange={(e) => handleChange('rootCause', e.target.value)}
            placeholder="Why is this happening?"
            disabled={isPastWeek}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Action Plan
          </label>
          <input
            type="text"
            className={inputClass}
            value={actionPlan}
            onChange={(e) => handleChange('actionPlan', e.target.value)}
            placeholder="What are we doing about it?"
            disabled={isPastWeek}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Owner
          </label>
          <input
            type="text"
            className={inputClass}
            value={owner}
            onChange={(e) => handleChange('owner', e.target.value)}
            placeholder="Who is responsible?"
            disabled={isPastWeek}
          />
        </div>
      </div>

      {/* Save indicator */}
      <div className="flex items-center gap-2 min-h-[20px]">
        {mutation.isPending && (
          <span className="text-xs text-muted">Saving...</span>
        )}
        {saved && (
          <span className="text-xs text-emerald-500">Saved</span>
        )}
        {mutation.isError && (
          <span className="text-xs text-red-400">Failed to save</span>
        )}
        {isPastWeek && (
          <span className="text-xs text-muted">Read-only (past week)</span>
        )}
      </div>

      {/* Diagnostic reference table */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-2">
          Diagnostic Framework
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-muted font-medium">
                  Signal
                </th>
                <th className="text-left py-2 px-3 text-muted font-medium">
                  Owner
                </th>
              </tr>
            </thead>
            <tbody>
              {BOTTLENECK_DIAGNOSTICS.map((row) => (
                <tr key={row.signal} className="border-b border-border/50">
                  <td className="py-2 px-3 text-foreground">{row.signal}</td>
                  <td className="py-2 px-3 text-muted">{row.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
