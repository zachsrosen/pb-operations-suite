/**
 * Solar Designer V12 Engine — Auto-Stringing
 *
 * Ports the V12 autoString algorithm. Groups panels into valid strings
 * by TSRF (high to low), respects cold-Voc voltage limits, and validates
 * each resulting string against the inverter's MPPT window.
 */
import type { StringConfig, PanelStat, ResolvedPanel, ResolvedInverter } from './types';

export interface AutoStringInput {
  panels: PanelStat[];
  panel: ResolvedPanel;
  inverter: ResolvedInverter;
  tempMin: number; // °C — coldest expected temp for Voc derating
}

export interface AutoStringResult {
  strings: StringConfig[];
  warnings: string[];
}

export function autoString(input: AutoStringInput): AutoStringResult {
  const { panels, panel, inverter, tempMin } = input;
  const warnings: string[] = [];

  if (panels.length === 0) return { strings: [], warnings };

  // 1. Calculate max panels per string from cold Voc
  const vocCold = panel.voc * (1 + panel.tempCoVoc * (tempMin - 25));
  const maxPerString = Math.floor(inverter.mpptMax / vocCold);

  // 2. Target string length: prefer 8-14, stay under max
  const optimalPerString = Math.max(8, Math.min(maxPerString - 1, 14));
  // If max is too small for 8, just use max
  const targetLen = maxPerString < 8 ? maxPerString : optimalPerString;

  // 3. Sort panels by descending TSRF (like panels together)
  const sorted = [...panels].sort((a, b) => b.tsrf - a.tsrf);
  const sortedIndices = sorted.map(p => p.id);

  // 4. Pack into strings
  const strings: StringConfig[] = [];
  for (let i = 0; i < sortedIndices.length; i += targetLen) {
    const chunk = sortedIndices.slice(i, i + targetLen);
    strings.push({ panels: chunk });
  }

  // 5. Validate each string
  for (const s of strings) {
    const stringVocCold = vocCold * s.panels.length;
    const stringVmpHot = panel.vmp * (1 + panel.tempCoVoc * (45 - 25)) * s.panels.length;

    if (stringVocCold > inverter.mpptMax) {
      warnings.push(`String of ${s.panels.length} panels: Voc_cold (${stringVocCold.toFixed(0)}V) exceeds MPPT max (${inverter.mpptMax}V)`);
    }
    if (stringVmpHot < inverter.mpptMin) {
      warnings.push(`String of ${s.panels.length} panels: Vmp_hot (${stringVmpHot.toFixed(0)}V) below MPPT min (${inverter.mpptMin}V)`);
    }
  }

  return { strings, warnings };
}
