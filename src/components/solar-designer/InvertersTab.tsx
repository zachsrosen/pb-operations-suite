'use client';

import { useState } from 'react';
import type { CoreSolarDesignerResult, ResolvedInverter, ResolvedPanel } from '@/lib/solar/v12-engine';
import type { UIInverterConfig, UIStringConfig, SolarDesignerAction } from './types';

const STRING_COLORS = [
  '#f97316', '#06b6d4', '#a78bfa', '#22c55e',
  '#f43f5e', '#eab308', '#ec4899', '#14b8a6',
  '#8b5cf6', '#f59e0b', '#10b981', '#6366f1',
];

interface InvertersTabProps {
  result: CoreSolarDesignerResult | null;
  inverters: UIInverterConfig[];
  strings: UIStringConfig[];
  selectedInverter: ResolvedInverter | null;
  selectedPanel: ResolvedPanel | null;
  resultStale: boolean;
  dispatch: (action: SolarDesignerAction) => void;
  onRerun?: () => void;
}

export default function InvertersTab({
  result, inverters, strings, selectedInverter, selectedPanel,
  resultStale, dispatch, onRerun,
}: InvertersTabProps) {
  const [selectedChip, setSelectedChip] = useState<{
    inverterId: number; channel: number; stringIndex: number;
  } | null>(null);

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see inverter configuration</p>
      </div>
    );
  }

  const handleChannelClick = (inverterId: number, channelIdx: number) => {
    if (!selectedChip) return;
    // No-op if clicking the same channel the chip is already in
    if (inverterId === selectedChip.inverterId && channelIdx === selectedChip.channel) {
      setSelectedChip(null);
      return;
    }
    dispatch({
      type: 'REASSIGN_STRING_TO_CHANNEL',
      stringIndex: selectedChip.stringIndex,
      fromInverterId: selectedChip.inverterId,
      fromChannel: selectedChip.channel,
      toInverterId: inverterId,
      toChannel: channelIdx,
    });
    setSelectedChip(null);
  };

  const calcDcAcRatio = (inv: UIInverterConfig) => {
    if (!selectedPanel || !selectedInverter) return 0;
    const totalPanels = inv.channels.reduce((sum, ch) =>
      sum + ch.stringIndices.reduce((s, si) => s + (strings[si]?.panelIds.length ?? 0), 0), 0);
    const dcPower = totalPanels * selectedPanel.vmp * selectedPanel.imp;
    return dcPower / selectedInverter.acPower;
  };

  const ratioColor = (ratio: number) =>
    ratio > 1.5 ? 'text-red-400 bg-red-500/10' :
    ratio > 1.2 ? 'text-yellow-400 bg-yellow-500/10' :
    'text-green-400 bg-green-500/10';

  return (
    <div className="space-y-4">
      {resultStale && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-yellow-400">Inverter config changed — results are stale.</p>
          {onRerun && (
            <button onClick={onRerun} className="text-xs font-medium text-yellow-400 hover:text-yellow-300 underline">
              Re-run
            </button>
          )}
        </div>
      )}

      {inverters.map(inv => {
        const ratio = calcDcAcRatio(inv);
        const clippingForInverter = result.clippingEvents.filter(e => e.inverterId === inv.inverterId);
        return (
          <div key={inv.inverterId} className="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold">
                  Inverter {inv.inverterId + 1} — {selectedInverter?.name ?? inv.inverterKey}
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ratioColor(ratio)}`}>
                  DC/AC {ratio.toFixed(2)}
                </span>
              </div>
              <span className="text-xs text-muted">{selectedInverter?.channels ?? inv.channels.length} MPPT channels</span>
            </div>

            <div className="space-y-2">
              {inv.channels.map((ch, ci) => (
                <div key={ci} onClick={() => handleChannelClick(inv.inverterId, ci)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors ${
                    selectedChip ? 'cursor-pointer hover:border-orange-500/50 hover:bg-orange-500/5' : ''
                  } ${
                    selectedChip?.inverterId === inv.inverterId && selectedChip?.channel === ci
                      ? 'border-orange-500/50 bg-orange-500/10' : 'border-border'
                  }`}
                >
                  <span className="text-xs text-muted w-14 shrink-0">MPPT {ci + 1}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {ch.stringIndices.length === 0 ? (
                      <span className="text-xs text-muted italic">— empty —</span>
                    ) : (
                      ch.stringIndices.map(si => {
                        const isSelected = selectedChip?.stringIndex === si &&
                          selectedChip?.inverterId === inv.inverterId &&
                          selectedChip?.channel === ci;
                        return (
                          <button key={si} onClick={(e) => {
                            e.stopPropagation();
                            setSelectedChip(isSelected ? null : {
                              inverterId: inv.inverterId, channel: ci, stringIndex: si,
                            });
                          }}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium transition-all ${
                              isSelected ? 'ring-2 ring-white/50 scale-105' : ''
                            }`}
                            style={{
                              backgroundColor: `${STRING_COLORS[si % STRING_COLORS.length]}20`,
                              color: STRING_COLORS[si % STRING_COLORS.length],
                            }}
                          >
                            S{strings[si]?.id ?? si + 1} ({strings[si]?.panelIds.length ?? 0}p)
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedPanel && selectedInverter && (
              <div className="text-xs text-muted pt-2 border-t border-border">
                DC Input: {(calcDcAcRatio(inv) * selectedInverter.acPower).toFixed(0)} W
                {' · '}AC Rated: {selectedInverter.acPower.toLocaleString()} W
              </div>
            )}

            <div className="text-xs text-muted pt-2 border-t border-border">
              {clippingForInverter.length > 0 ? (
                <div className="space-y-1">
                  <p>Clipped: {(clippingForInverter.reduce((s, e) => s + e.totalClipWh, 0) / 1000).toFixed(1)} kWh/year</p>
                  <p>Peak: {Math.max(...clippingForInverter.map(e => e.peakClipW)).toLocaleString()} W · {clippingForInverter.length} events</p>
                </div>
              ) : (
                <p className="italic">Clipping analysis available after dispatch module (Stage 5).</p>
              )}
            </div>
          </div>
        );
      })}

      {result.clippingEvents.length > 0 && (
        <details className="bg-surface rounded-lg border border-border">
          <summary className="px-4 py-2 text-xs text-muted cursor-pointer hover:text-foreground">
            Clipping Event Log ({result.clippingEvents.length} events)
          </summary>
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Date</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Start</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">End</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Duration</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Peak (W)</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Total (Wh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.clippingEvents.map((e, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1">{e.date}</td>
                    <td className="px-3 py-1">{e.startTime}</td>
                    <td className="px-3 py-1">{e.endTime}</td>
                    <td className="px-3 py-1">{e.durationMin}m</td>
                    <td className="px-3 py-1">{e.peakClipW.toLocaleString()}</td>
                    <td className="px-3 py-1">{e.totalClipWh.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
