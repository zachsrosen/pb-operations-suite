import { generateConsumptionProfile } from '@/lib/solar/v12-engine/consumption';
import { generateConsumptionProfile as originalGenerateConsumptionProfile } from '@/lib/solar/engine/consumption';

describe('v12-engine/consumption re-exports', () => {
  it('generateConsumptionProfile is the same function', () => {
    expect(generateConsumptionProfile).toBe(originalGenerateConsumptionProfile);
  });
});
