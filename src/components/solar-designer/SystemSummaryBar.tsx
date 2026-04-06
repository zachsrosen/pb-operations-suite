'use client';

import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';

interface SystemSummaryBarProps {
  panelCount: number;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;
  stringCount: number;
}

export default function SystemSummaryBar({
  panelCount, selectedPanel, selectedInverter, stringCount,
}: SystemSummaryBarProps) {
  if (panelCount === 0 && !selectedPanel) return null;

  const systemKw = selectedPanel ? (selectedPanel.watts * panelCount) / 1000 : 0;

  return (
    <div className="rounded-xl bg-surface p-3 shadow-card">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {panelCount > 0 && (
          <>
            <div>
              <span className="text-muted">Panels</span>
              <p className="text-sm font-semibold text-foreground">{panelCount}</p>
            </div>
            {selectedPanel && (
              <div>
                <span className="text-muted">System</span>
                <p className="text-sm font-semibold text-foreground">{systemKw.toFixed(2)} kW</p>
              </div>
            )}
          </>
        )}
        {selectedPanel && (
          <div className="col-span-2 truncate">
            <span className="text-muted">Panel:</span>{' '}
            <span className="text-foreground">{selectedPanel.name}</span>
          </div>
        )}
        {selectedInverter && (
          <div className="col-span-2 truncate">
            <span className="text-muted">Inverter:</span>{' '}
            <span className="text-foreground">{selectedInverter.name}</span>
          </div>
        )}
        {stringCount > 0 && (
          <div>
            <span className="text-muted">Strings</span>
            <p className="text-sm font-semibold text-foreground">{stringCount}</p>
          </div>
        )}
      </div>
    </div>
  );
}
