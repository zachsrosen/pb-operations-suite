/**
 * Solar Designer — Inverter Bridge Utilities
 *
 * Bridges between the UI's per-channel UIInverterConfig and the engine's
 * flat InverterConfig. Also provides auto-assignment of strings to MPPT channels.
 */
import type { InverterConfig } from '@/lib/solar/v12-engine';
import type { UIInverterConfig } from './types';

/**
 * Auto-distribute N strings across MPPT channels, one string per channel.
 * Creates as many inverters as needed to accommodate all strings.
 */
export function autoAssignInverters(
  stringCount: number,
  channelsPerInverter: number,
  inverterKey: string,
): UIInverterConfig[] {
  if (stringCount === 0) return [];

  const inverterCount = Math.ceil(stringCount / channelsPerInverter);
  const result: UIInverterConfig[] = [];

  for (let i = 0; i < inverterCount; i++) {
    const channels: { stringIndices: number[] }[] = [];
    for (let j = 0; j < channelsPerInverter; j++) {
      const stringIndex = i * channelsPerInverter + j;
      channels.push({
        stringIndices: stringIndex < stringCount ? [stringIndex] : [],
      });
    }
    result.push({ inverterId: i, inverterKey, channels });
  }

  return result;
}

/**
 * Flatten UIInverterConfig[] → engine InverterConfig[].
 * Merges all channel string indices into a single flat array per inverter.
 */
export function flattenInverterConfigs(
  uiConfigs: UIInverterConfig[],
): InverterConfig[] {
  return uiConfigs.map(ui => ({
    inverterKey: ui.inverterKey,
    stringIndices: ui.channels.flatMap(ch => ch.stringIndices),
  }));
}
