import { runModelB, computeMismatchLoss } from '@/lib/solar/v12-engine/mismatch';
import { runModelB as originalRunModelB } from '@/lib/solar/engine/model-b';
import { computeMismatchLoss as originalComputeMismatchLoss } from '@/lib/solar/engine/architecture';

describe('v12-engine/mismatch re-exports', () => {
  it('runModelB is the same function as the original', () => {
    expect(runModelB).toBe(originalRunModelB);
  });

  it('computeMismatchLoss is the same function as the original', () => {
    expect(computeMismatchLoss).toBe(originalComputeMismatchLoss);
  });

  it('computeMismatchLoss returns 0 for equal inputs', () => {
    const result = computeMismatchLoss(1000, 1000, 'string');
    expect(result).toBe(0);
  });

  it('computeMismatchLoss returns positive for string mismatch', () => {
    const result = computeMismatchLoss(1000, 950, 'string');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });
});
