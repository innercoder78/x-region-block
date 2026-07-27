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
  it('canonicalizes identity and location while discarding all undocumented fields', () => {
    const subject = createFilterSubject({
      ...input(), languages: ['EN'], tags: ['News'], token: 'secret', arbitraryDom: { node: true },
    });
    expect(subject).toEqual({
      identity: {
        handle: 'example_user', displayHandle: '@example_user', profileUrl: 'https://x.com/example_user',
        accountId: '00123', allowlistKey: '@example_user', source: 'timeline',
      },
      allowlistKey: '@example_user',
      location: {
        status: 'known', countryCode: 'CA', countryName: 'Canada', regionCode: 'NORTH_AMERICA',
        regionName: 'North America', rawLocation: null, source: null,
      },
    });
    expect(Object.keys(subject)).toEqual(['identity', 'allowlistKey', 'location']);
  });

  it.each(['hidden', 'missing', 'unavailable', 'unknown'])('preserves the distinct %s location', (status) => {
    const subject = createFilterSubject({ ...input(), location: { status, rawLocation: 'private' } });
    expect(subject.location.status).toBe(status);
    expect(subject.location.rawLocation).toBe('private');
    expect(subject.location.countryCode).toBeNull();
  });

  it('derives a region and deeply freezes fresh output', () => {
    const location = { ...knownLocation() }; delete location.regionCode;
    const first = createFilterSubject({ ...input(), location });
    const second = createFilterSubject({ ...input(), location });
    expect(first.location.regionCode).toBe('NORTH_AMERICA');
    expect(first).not.toBe(second);
    for (const value of [first, first.identity, first.location]) expect(Object.isFrozen(value)).toBe(true);
  });

  it('accepts deeply frozen inputs without mutation', () => {
    const supplied = Object.freeze({ identity: Object.freeze(input().identity), location: Object.freeze(knownLocation()), languages: 'ignored' });
    const before = structuredClone(supplied);
    expect(createFilterSubject(supplied).location.countryCode).toBe('CA');
    expect(supplied).toEqual(before);
  });

  it.each([
    [undefined, 'filter subject input'], [null, 'filter subject input'], [[], 'filter subject input'],
    [{ location: { status: 'missing' } }, 'identity'], [{ identity: { handle: 'user' } }, 'location'],
    [{ ...input(), identity: { handle: 'invalid handle' } }, 'Invalid X handle'],
    [{ ...input(), location: { status: 'invented' } }, 'Unsupported location status'],
  ])('rejects malformed canonical input %#', (value, message) => {
    expect(() => createFilterSubject(value)).toThrow(message);
  });

  it('has no browser or scheduling side effects', () => {
    const spies = [vi.spyOn(globalThis, 'fetch'), vi.spyOn(globalThis, 'setTimeout'), vi.spyOn(globalThis, 'setInterval')];
    createFilterSubject(input());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
