/**
 * V12 Parity Test — validates CoreRunner matches existing runner within tolerance.
 *
 * The CoreRunner resolves equipment from the built-in catalog and creates
 * PanelStat[] from PanelGeometry[], while the existing runner uses pre-resolved
 * equipment and PanelStat[] directly from the fixture. The legacyFixtureToCoreInput
 * adapter injects per-panel TSRF to preserve exact values, so parity should be
 * tight (within 0.1%) for Model A and system stats.
 */
import { runAnalysis } from '@/lib/solar/engine/runner';
import { runCoreAnalysis, legacyFixtureToCoreInput } from '@/lib/solar/v12-engine/runner';
import type { RunnerInput } from '@/lib/solar/engine/engine-types';
import type { WorkerProgressMessage } from '@/lib/solar/types';
import fixture from './fixtures/synthetic-10-panel.json';
import { expectClose } from './test-helpers';

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe('V12 Parity: CoreRunner vs existing Runner', () => {
  const legacyInput = fixture as unknown as RunnerInput;
  const existingResult = runAnalysis(legacyInput, noopProgress);

  const coreInput = legacyFixtureToCoreInput(legacyInput);
  const coreResult = runCoreAnalysis(coreInput, noopProgress);

  it('Model A annual kWh within 0.1%', () => {
    // existingResult.modelA.annualKwh is post-derate; coreResult.production.independentAnnual is also post-derate
    const tolerance = existingResult.modelA.annualKwh * 0.001;
    expectClose(
      coreResult.production.independentAnnual,
      existingResult.modelA.annualKwh,
      tolerance,
      'Model A annual'
    );
  });

  it('Model B annual kWh within 0.1% (string architecture)', () => {
    if (!existingResult.modelB) return;
    const tolerance = existingResult.modelB.annualKwh * 0.001;
    expectClose(
      coreResult.production.stringLevelAnnual,
      existingResult.modelB.annualKwh,
      tolerance,
      'Model B annual'
    );
  });

  it('Mismatch loss % within 0.1 percentage points', () => {
    if (!existingResult.modelB) return;
    expectClose(
      coreResult.mismatchLossPct,
      existingResult.modelB.mismatchLossPct,
      0.1,
      'Mismatch %'
    );
  });

  it('Panel count matches', () => {
    expect(coreResult.panelCount).toBe(existingResult.panelCount);
  });

  it('System size matches', () => {
    expectClose(coreResult.systemSizeKw, existingResult.systemSizeKw, 0.01, 'System kW');
  });
});
