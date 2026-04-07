'use client';

import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';
import { getBuiltInPanels, getBuiltInInverters, resolvePanel, resolveInverter } from '@/lib/solar/v12-engine';
import type { SolarDesignerAction } from './types';

interface EquipmentPanelProps {
  panelKey: string;
  inverterKey: string;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;
  dispatch: (action: SolarDesignerAction) => void;
}

const panels = getBuiltInPanels();
const inverters = getBuiltInInverters();

export default function EquipmentPanel({
  panelKey, inverterKey, selectedPanel, selectedInverter, dispatch,
}: EquipmentPanelProps) {
  const handlePanelChange = (key: string) => {
    const panel = resolvePanel(key);
    if (panel) dispatch({ type: 'SET_PANEL', key, panel });
  };

  const handleInverterChange = (key: string) => {
    const inverter = resolveInverter(key);
    if (inverter) dispatch({ type: 'SET_INVERTER', key, inverter });
  };

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Equipment</h3>
      <div>
        <label htmlFor="panel-select" className="block text-xs font-medium text-muted mb-1">Panel</label>
        <select id="panel-select" value={panelKey} onChange={(e) => handlePanelChange(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
          <option value="">Select panel...</option>
          {panels.map((p) => (<option key={p.key} value={p.key}>{p.name} ({p.watts}W)</option>))}
        </select>
        {selectedPanel && (
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
            <span>{selectedPanel.watts}W</span>
            <span>Voc {selectedPanel.voc.toFixed(1)}V</span>
            <span>Vmp {selectedPanel.vmp.toFixed(1)}V</span>
            <span>{selectedPanel.cells} cells</span>
            {selectedPanel.isBifacial && <span className="col-span-2 text-orange-500">Bifacial</span>}
          </div>
        )}
      </div>
      <div>
        <label htmlFor="inverter-select" className="block text-xs font-medium text-muted mb-1">Inverter</label>
        <select id="inverter-select" value={inverterKey} onChange={(e) => handleInverterChange(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
          <option value="">Select inverter...</option>
          {inverters.map((inv) => (<option key={inv.key} value={inv.key}>{inv.name} ({(inv.acPower / 1000).toFixed(1)}kW)</option>))}
        </select>
        {selectedInverter && (
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
            <span>AC {(selectedInverter.acPower / 1000).toFixed(1)}kW</span>
            <span>MPPT {selectedInverter.mpptMin}-{selectedInverter.mpptMax}V</span>
            <span>Eff {(selectedInverter.efficiency * 100).toFixed(1)}%</span>
            <span className="capitalize">{selectedInverter.architectureType}</span>
          </div>
        )}
      </div>
    </div>
  );
}
