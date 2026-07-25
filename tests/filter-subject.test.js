import { describe, expect, it, vi } from 'vitest';

import { createFilterSubject } from '../src/shared/filter-subject.js';

const knownLocation = () => ({
  status: 'known', countryCode: 'ca', countryName: 'Canada', regionCode: 'north_america',
});
const input = () => ({
  identity: { handle: ' Example_User ', accountId: '00123', source: ' Timeline ' },
  location: knownLocation(),
});

describe('filter subject', () => {
  it('canonicalizes identity and known location while copying only documented fields', () => {
    const subject = createFilterSubject({
      ...input(),
      languages: [' EN ', 'en', 'ES'],
      tags: [' News ', '#Topic', 'news'],
      token: 'secret',
      arbitraryDom: { node: true },
    });

    expect(subject).toEqual({
      identity: {
        handle: 'example_user', displayHandle: '@example_user',
        profileUrl: 'https://x.com/example_user', accountId: '00123',
        allowlistKey: '@example_user', source: 'timeline',
      },
      allowlistKey: '@example_user',
      location: {
        status: 'known', countryCode: 'CA', countryName: 'Canada',
        regionCode: 'NORTH_AMERICA', regionName: 'North America', rawLocation: null, source: null,
      },
      languages: ['en', 'es'],
      tags: ['news', '#topic'],
    });
    expect(Object.keys(subject)).toEqual(['identity', 'allowlistKey', 'location', 'languages', 'tags']);
  });

  it.each(['hidden', 'missing', 'unavailable', 'unknown'])('preserves the distinct %s location', (status) => {
    const subject = createFilterSubject({ ...input(), location: { status, rawLocation: 'private' } });
    expect(subject.location.status).toBe(status);
    expect(subject.location.rawLocation).toBe('private');
    expect(subject.location.countryCode).toBeNull();
  });

  it('derives a region and uses fresh frozen defaults', () => {
    const withoutRegion = { ...knownLocation() };
    delete withoutRegion.regionCode;
    const first = createFilterSubject({ ...input(), location: withoutRegion });
    const second = createFilterSubject({ ...input(), location: withoutRegion });
    expect(first.location.regionCode).toBe('NORTH_AMERICA');
    expect(first.languages).toEqual([]);
    expect(first.languages).not.toBe(second.languages);
    expect(first.tags).not.toBe(second.tags);
    for (const value of [first, first.identity, first.location, first.languages, first.tags]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('accepts deeply frozen inputs without mutation', () => {
    const supplied = Object.freeze({
      identity: Object.freeze(input().identity),
      location: Object.freeze(knownLocation()),
      languages: Object.freeze([' EN ']),
      tags: Object.freeze([' News ']),
    });
    const before = structuredClone(supplied);
    expect(createFilterSubject(supplied).languages).toEqual(['en']);
    expect(supplied).toEqual(before);
  });

  it.each([
    [undefined, 'filter subject input'], [null, 'filter subject input'], [[], 'filter subject input'],
    [{ location: { status: 'missing' } }, 'identity'],
    [{ identity: { handle: 'user' } }, 'location'],
    [{ ...input(), identity: { handle: 'invalid handle' } }, 'Invalid X handle'],
    [{ ...input(), location: { status: 'invented' } }, 'Unsupported location status'],
    [{ ...input(), languages: 'en' }, 'languages must be an array'],
    [{ ...input(), tags: new Set(['news']) }, 'tags must be an array'],
    [{ ...input(), languages: [' '] }, 'languages entries must be non-empty strings'],
    [{ ...input(), tags: [1] }, 'tags entries must be non-empty strings'],
  ])('rejects malformed canonical input %#', (value, message) => {
    expect(() => createFilterSubject(value)).toThrow(message);
  });

  it('has no browser or scheduling side effects', () => {
    const spies = [
      vi.spyOn(globalThis, 'fetch'), vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
    ];
    createFilterSubject(input());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
