import { runModelA } from '@/lib/solar/v12-engine/production';
import { runModelA as originalRunModelA } from '@/lib/solar/engine/model-a';

describe('v12-engine/production re-exports', () => {
  it('runModelA is the same function', () => {
    expect(runModelA).toBe(originalRunModelA);
  });
});
