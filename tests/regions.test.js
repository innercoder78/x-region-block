import { describe, expect, it } from 'vitest';
import { REGION_CODES, REGIONS, getRegion, getRegionName } from '../src/shared/regions.js';

describe('regions', () => {
  it('looks up a valid region', () => {
    expect(getRegion(REGION_CODES.EUROPE)).toEqual({ code: 'EUROPE', name: 'Europe' });
    expect(getRegionName('EUROPE')).toBe('Europe');
  });

  it('normalizes lookup case', () => {
    expect(getRegion('middle_east')).toBe(REGIONS.MIDDLE_EAST);
  });

  it('returns null for invalid lookups', () => {
    expect(getRegion('ATLANTIS')).toBeNull();
    expect(getRegion(null)).toBeNull();
    expect(getRegionName('ATLANTIS')).toBeNull();
  });

  it('publishes immutable definitions', () => {
    expect(Object.isFrozen(REGION_CODES)).toBe(true);
    expect(Object.isFrozen(REGIONS)).toBe(true);
    expect(Object.isFrozen(REGIONS.AFRICA)).toBe(true);
  });
});
