import { describe, expect, it } from 'vitest';
import { decideFilterAction } from '../src/shared/filter-engine.js';
import { createFilterSubject } from '../src/shared/filter-subject.js';
import {
  createHiddenLocation,
  createKnownLocation,
  createLocationResult,
} from '../src/shared/location-model.js';
import { createLocationDisplayModel } from '../src/shared/location-display.js';

const subjectInput = (location) => ({ identity: { handle: 'example' }, location });

describe('location display integration', () => {
  it('accepts known-location and filter-subject locations directly without changing them', () => {
    const canonical = createKnownLocation({ countryCode: 'CA', countryName: 'Canada' });
    const subject = createFilterSubject(subjectInput(canonical));
    const before = structuredClone(subject);
    expect(createLocationDisplayModel(canonical).country.code).toBe('CA');
    expect(createLocationDisplayModel(subject.location).region.code).toBe('NORTH_AMERICA');
    expect(subject).toEqual(before);
  });

  it.each([
    [{}, 'show'],
    [{ country: { highlight: ['CA'] } }, 'highlight'],
    [{ region: { hide: ['NORTH_AMERICA'] } }, 'hide'],
  ])('keeps display descriptors independent of the %s decision', (settings, expected) => {
    const subject = createFilterSubject(subjectInput(createKnownLocation({ countryCode: 'CA', countryName: 'Canada' })));
    const before = decideFilterAction(subject, settings);
    const display = createLocationDisplayModel(subject.location);
    expect(decideFilterAction(subject, settings)).toBe(before);
    expect(before).toBe(expected);
    expect(display.country.code).toBe('CA');
    expect(display.region.code).toBe('NORTH_AMERICA');
    expect(Object.keys(subject)).not.toContain('display');
  });

  it('keeps Antarctica known without a configurable region', () => {
    const location = createKnownLocation({ countryCode: 'AQ', countryName: 'Antarctica' });
    const subject = createFilterSubject(subjectInput(location));
    const display = createLocationDisplayModel(subject.location);
    expect(display.status).toBe('known');
    expect(display.region.code).toBeNull();
    expect(decideFilterAction(subject, { region: { hide: ['UNKNOWN'] } })).toBe('show');
    expect(decideFilterAction(subject, { other: { hide: ['unknown'] } })).toBe('show');
  });

  it.each(['hidden', 'missing', 'unavailable', 'unknown'])(
    'preserves %s filter behavior while creating display data',
    (status) => {
      const location = status === 'hidden' ? createHiddenLocation() : createLocationResult({ status });
      const subject = createFilterSubject(subjectInput(location));
      const before = structuredClone(subject);
      createLocationDisplayModel(subject.location);
      expect(subject).toEqual(before);
      expect(decideFilterAction(subject, { other: { hide: [status] } })).toBe('hide');
      expect(decideFilterAction(subject, { other: { highlight: [status] } })).toBe('highlight');
      expect(decideFilterAction(subject, {})).toBe('show');
    },
  );
});
