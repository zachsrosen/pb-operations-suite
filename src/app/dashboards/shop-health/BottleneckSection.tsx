'use client';

import { useState, useCallback, useRef } from 'react';
import {
  useBottleneckCreate,
  useBottleneckUpdate,
  useBottleneckDelete,
} from '@/hooks/useShopHealthData';
import {
  BOTTLENECK_DIAGNOSTICS,
  type ShopHealthBottleneckEntry,
} from '@/lib/shop-health-types';
import { getWeekStart } from '@/lib/shop-health-utils';

interface BottleneckSectionProps {
  location: string;
  weekStart: string;
  bottlenecks: ShopHealthBottleneckEntry[];
}

const AUTOSAVE_DELAY = 1500;

const inputClass =
  'w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-foreground text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed';

// ─── Individual bottleneck entry card ────────────────────────────────────────

function BottleneckEntryCard({
  entry,
  location,
  weekStart,
  isPastWeek,
}: {
  entry: ShopHealthBottleneckEntry;
  location: string;
  weekStart: string;
  isPastWeek: boolean;
}) {
  const [constraint, setConstraint] = useState(entry.constraint ?? '');
  const [rootCause, setRootCause] = useState(entry.rootCause ?? '');
  const [actionPlan, setActionPlan] = useState(entry.actionPlan ?? '');
  const [owner, setOwner] = useState(entry.owner ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMutation = useBottleneckUpdate(location, weekStart);
  const deleteMutation = useBottleneckDelete(location, weekStart);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoSave = useCallback(
    (fields: { constraint: string; rootCause: string; actionPlan: string; owner: string }) => {
      if (isPastWeek) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        updateMutation.mutate(
          {
            id: entry.id,
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
    [entry.id, isPastWeek, updateMutation]
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

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    deleteMutation.mutate(entry.id);
  }

  return (
    <div className="bg-surface-2 rounded-xl p-4 space-y-3 border border-border/50">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Constraint</label>
          <input
            type="text"
            className={inputClass}
            value={constraint}
            onChange={(e) => handleChange('constraint', e.target.value)}
            placeholder="What is the bottleneck?"
            disabled={isPastWeek}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Root Cause</label>
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
          <label className="block text-xs font-medium text-muted mb-1">Action Plan</label>
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
          <label className="block text-xs font-medium text-muted mb-1">Owner</label>
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

      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-h-[20px]">
          {updateMutation.isPending && <span className="text-xs text-muted">Saving...</span>}
          {saved && <span className="text-xs text-emerald-500">Saved</span>}
          {updateMutation.isError && <span className="text-xs text-red-400">Failed to save</span>}
          {isPastWeek && <span className="text-xs text-muted">Read-only (past week)</span>}
        </div>
        {!isPastWeek && (
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              confirmDelete
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'text-muted hover:text-red-400 hover:bg-red-500/10'
            }`}
          >
            {deleteMutation.isPending
              ? 'Removing...'
              : confirmDelete
                ? 'Confirm remove?'
                : 'Remove'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── New bottleneck form ─────────────────────────────────────────────────────

function NewBottleneckForm({
  location,
  weekStart,
  onComplete,
}: {
  location: string;
  weekStart: string;
  onComplete: () => void;
}) {
  const [constraint, setConstraint] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [actionPlan, setActionPlan] = useState('');
  const [owner, setOwner] = useState('');

  const createMutation = useBottleneckCreate(location, weekStart);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!constraint.trim()) return;

    createMutation.mutate(
      {
        location,
        weekStart,
        constraint: constraint.trim() || null,
        rootCause: rootCause.trim() || null,
        actionPlan: actionPlan.trim() || null,
        owner: owner.trim() || null,
      },
      {
        onSuccess: () => {
          setConstraint('');
          setRootCause('');
          setActionPlan('');
          setOwner('');
          onComplete();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-2/50 rounded-xl p-4 space-y-3 border border-dashed border-border">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Constraint *</label>
          <input
            type="text"
            className={inputClass}
            value={constraint}
            onChange={(e) => setConstraint(e.target.value)}
            placeholder="What is the bottleneck?"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Root Cause</label>
          <input
            type="text"
            className={inputClass}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="Why is this happening?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Action Plan</label>
          <input
            type="text"
            className={inputClass}
            value={actionPlan}
            onChange={(e) => setActionPlan(e.target.value)}
            placeholder="What are we doing about it?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Owner</label>
          <input
            type="text"
            className={inputClass}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Who is responsible?"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={createMutation.isPending || !constraint.trim()}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createMutation.isPending ? 'Adding...' : 'Add Bottleneck'}
        </button>
        {createMutation.isError && (
          <span className="text-xs text-red-400">Failed to add</span>
        )}
      </div>
    </form>
  );
}

// ─── Main section ────────────────────────────────────────────────────────────

export function BottleneckSectionContent({
  location,
  weekStart,
  bottlenecks,
}: BottleneckSectionProps) {
  const [showForm, setShowForm] = useState(false);

  // Determine if this is a past week (read-only)
  const currentWeek = getWeekStart(new Date());
  const weekDate = new Date(weekStart + 'T00:00:00');
  const isPastWeek = weekDate.getTime() < currentWeek.getTime();

  return (
    <div className="space-y-4">
      {/* Existing bottleneck entries */}
      {bottlenecks.length > 0 ? (
        <div className="space-y-3">
          {bottlenecks.map((entry) => (
            <BottleneckEntryCard
              key={entry.id}
              entry={entry}
              location={location}
              weekStart={weekStart}
              isPastWeek={isPastWeek}
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted text-center py-4">
          No bottlenecks logged this week.
        </div>
      )}

      {/* Add button / form */}
      {!isPastWeek && (
        <>
          {showForm ? (
            <NewBottleneckForm
              location={location}
              weekStart={weekStart}
              onComplete={() => setShowForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-2 text-sm font-medium text-muted border border-dashed border-border rounded-xl hover:border-orange-500/50 hover:text-orange-400 transition-colors"
            >
              + Add Bottleneck
            </button>
          )}
        </>
      )}

      {/* Diagnostic reference table */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-2">Diagnostic Framework</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-muted font-medium">Signal</th>
                <th className="text-left py-2 px-3 text-muted font-medium">Owner</th>
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
