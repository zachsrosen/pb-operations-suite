'use client';

import { useMemo } from 'react';
import { validateString } from '@/lib/solar/v12-engine/string-validation';
import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';
import type { UIStringConfig, SolarDesignerAction } from './types';

const STRING_COLORS = [
  '#f97316', '#06b6d4', '#a78bfa', '#22c55e',
  '#f43f5e', '#eab308', '#ec4899', '#14b8a6',
  '#8b5cf6', '#f59e0b', '#10b981', '#6366f1',
];

interface StringListProps {
  strings: UIStringConfig[];
  activeStringId: number | null;
  totalPanelCount: number;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;
  tempMin: number;
  tempMax: number;
  dispatch: (action: SolarDesignerAction) => void;
}

interface ValidationBadgeProps {
  status: 'valid' | 'warning' | 'error';
  message: string | null;
}

function ValidationBadge({ status, message }: ValidationBadgeProps) {
  if (status === 'valid') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">OK</span>;
  }
  if (status === 'warning') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400" title={message ?? ''}>
        WARN
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400" title={message ?? ''}>
      ERR
    </span>
  );
}

export default function StringList({
  strings,
  activeStringId,
  totalPanelCount,
  selectedPanel,
  selectedInverter,
  tempMin,
  tempMax,
  dispatch,
}: StringListProps) {
  const assignedCount = useMemo(
    () => strings.reduce((sum, s) => sum + s.panelIds.length, 0),
    [strings]
  );
  const unassignedCount = totalPanelCount - assignedCount;
  const canValidate = selectedPanel !== null && selectedInverter !== null;

  return (
    <div className="space-y-2 w-64 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Strings</h3>
        <div className="flex gap-1">
          <button
            aria-label="New string"
            onClick={() => dispatch({ type: 'CREATE_STRING' })}
            className="px-2 py-1 text-xs font-medium rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            New
          </button>
        </div>
      </div>

      {/* String cards */}
      {strings.map((s, index) => {
        const colorIdx = index % STRING_COLORS.length;
        const isActive = s.id === activeStringId;
        const validation = canValidate
          ? validateString(s.panelIds.length, selectedPanel!, selectedInverter!, tempMin, tempMax)
          : null;

        return (
          <div
            key={s.id}
            onClick={() => dispatch({ type: 'SET_ACTIVE_STRING', stringId: s.id })}
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              isActive
                ? 'bg-surface-elevated ring-1 ring-orange-500'
                : 'bg-surface hover:bg-surface-2'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: STRING_COLORS[colorIdx] }}
                />
                <span className="text-xs font-semibold text-foreground">
                  String {index + 1}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {validation && <ValidationBadge status={validation.status} message={validation.message} />}
                <button
                  aria-label="Delete string"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'DELETE_STRING', stringId: s.id });
                  }}
                  className="text-muted hover:text-red-500 text-xs px-1 transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="text-xs text-muted">
              {s.panelIds.length} panel{s.panelIds.length !== 1 ? 's' : ''}
            </div>
            {validation && s.panelIds.length > 0 && (
              <div className="mt-1 text-[10px] text-muted font-mono">
                Voc: {validation.vocCold.toFixed(0)}V | Vmp: {validation.vmpHot.toFixed(0)}V
                <br />
                MPPT: {validation.mpptMin}–{validation.mpptMax}V
              </div>
            )}
            {validation?.message && (
              <div className={`mt-1 text-[10px] ${validation.status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                {validation.message}
              </div>
            )}
          </div>
        );
      })}

      {/* Unassigned count */}
      <div className="p-2 rounded-lg bg-surface-2 text-xs text-muted text-center">
        {unassignedCount} unassigned panel{unassignedCount !== 1 ? 's' : ''}
      </div>

      {/* Auto-string explainer */}
      {!canValidate && strings.length === 0 && (
        <p className="text-[11px] text-muted px-1">
          Select a panel module and inverter to enable auto-stringing and voltage validation.
        </p>
      )}
    </div>
  );
}
