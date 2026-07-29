import { describe, expect, it } from 'vitest';
import { REGION_CODES, REGIONS, getRegion, getRegionByName, getRegionName } from '../src/shared/regions.js';

describe('regions', () => {
  it('looks up a valid region', () => {
    expect(getRegion(REGION_CODES.EUROPE)).toEqual({ code: 'EUROPE', name: 'Europe' });
    expect(getRegionName('EUROPE')).toBe('Europe');
  });

  it('normalizes lookup case', () => {
    expect(getRegion('middle_east')).toBe(REGIONS.MIDDLE_EAST);
  });

  it.each(Object.values(REGIONS).filter(({ code }) => code !== 'UNKNOWN'))(
    'looks up canonical region name $name safely', ({ code, name }) => {
      expect(getRegionByName(`  ${name.toUpperCase()}  `)).toBe(REGIONS[code]);
    },
  );

  it('does not guess unsupported names', () => {
    expect(getRegionByName('Northern America')).toBeNull();
    expect(getRegionByName('America')).toBeNull();
    expect(getRegionByName('Unknown')).toBeNull();
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
