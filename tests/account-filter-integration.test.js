import { describe, expect, it } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { decideFilterAction } from '../src/shared/filter-engine.js';
import { createKnownLocation, createUnknownLocation } from '../src/shared/location-model.js';

const identity = createAccountIdentity({ handle: 'OpenAI' });
const canada = createKnownLocation({
  countryCode: 'CA',
  countryName: 'Canada',
  regionCode: 'NORTH_AMERICA',
});
const subject = (location) => ({ allowlistKey: identity.allowlistKey, location, languages: [], tags: [] });

describe('canonical account identity filter integration', () => {
  it.each([
    [{ country: { hide: ['CA'] } }, canada],
    [{ region: { hide: ['NORTH_AMERICA'] } }, canada],
    [{ other: { hide: ['unknown'] } }, createUnknownLocation()],
  ])('lets the canonical allowlist key override a hide', (rule, location) => {
    expect(decideFilterAction(subject(location), { allowlist: ['@openai'], ...rule })).toBe('show');
  });

  it('keeps allowlist matching exact and case-sensitive', () => {
    expect(
      decideFilterAction(subject(canada), { allowlist: ['@OpenAI'], country: { hide: ['CA'] } }),
    ).toBe('hide');
    expect(
      decideFilterAction(subject(canada), { allowlist: ['@notopenai'], country: { hide: ['CA'] } }),
    ).toBe('hide');
  });

  it('preserves country alwaysShow behavior', () => {
    expect(
      decideFilterAction(subject(canada), {
        country: { alwaysShow: ['CA'], hide: ['CA'] },
        region: { hide: ['NORTH_AMERICA'] },
      }),
    ).toBe('show');
  });

  it('preserves hide-over-highlight precedence and ordinary highlights', () => {
    expect(
      decideFilterAction(subject(canada), {
        country: { hide: ['CA'] },
        region: { highlight: ['NORTH_AMERICA'] },
      }),
    ).toBe('hide');
    expect(decideFilterAction(subject(canada), { country: { highlight: ['CA'] } })).toBe('highlight');
  });
});
