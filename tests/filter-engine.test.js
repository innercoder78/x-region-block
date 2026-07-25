import { describe, expect, it } from 'vitest';
import { decideFilterAction } from '../src/shared/filter-engine.js';
import {
  createHiddenLocation,
  createKnownLocation,
  createMissingLocation,
  createUnavailableLocation,
  createUnknownLocation,
} from '../src/shared/location-model.js';

const canada = createKnownLocation({
  countryCode: 'CA',
  countryName: 'Canada',
  regionCode: 'NORTH_AMERICA',
});
const subject = { allowlistKey: 'account-a', location: canada, languages: ['en'], tags: ['news'] };

describe('filter engine', () => {
  it('shows by default with empty or missing categories', () => {
    expect(decideFilterAction(subject, {})).toBe('show');
    expect(decideFilterAction({ location: canada }, { country: {} })).toBe('show');
  });

  it('lets an allowlist match override every hide rule', () => {
    expect(
      decideFilterAction(subject, {
        allowlist: ['account-a'],
        country: { hide: ['CA'] },
        region: { hide: ['NORTH_AMERICA'] },
        other: { hide: ['unknown'] },
      }),
    ).toBe('show');
  });

  it.each([
    [{ country: { alwaysShow: ['ca'], hide: ['CA'] } }, 'country'],
    [{ country: { alwaysShow: ['CA'] }, region: { hide: ['north_america'] } }, 'region'],
  ])('lets an always-show country override a %s hide', (settings) => {
    expect(decideFilterAction(subject, settings)).toBe('show');
  });

  it('applies country and region hides case-safely', () => {
    expect(decideFilterAction(subject, { country: { hide: ['ca'] } })).toBe('hide');
    expect(decideFilterAction(subject, { region: { hide: ['north_america'] } })).toBe('hide');
  });

  it('gives a country hide precedence over a region highlight', () => {
    expect(
      decideFilterAction(subject, {
        country: { hide: ['CA'] },
        region: { highlight: ['NORTH_AMERICA'] },
      }),
    ).toBe('hide');
  });

  it('highlights matching geographic, language, or tag rules', () => {
    expect(decideFilterAction(subject, { country: { highlight: ['CA'] } })).toBe('highlight');
    expect(decideFilterAction(subject, { language: { highlight: ['EN'] } })).toBe('highlight');
    expect(decideFilterAction(subject, { tag: { highlight: ['NEWS'] } })).toBe('highlight');
  });

  it('gives hide precedence over highlight', () => {
    expect(
      decideFilterAction(subject, { country: { highlight: ['CA'] }, region: { hide: ['NORTH_AMERICA'] } }),
    ).toBe('hide');
  });

  it.each([
    ['hidden', createHiddenLocation],
    ['missing', createMissingLocation],
    ['unavailable', createUnavailableLocation],
    ['unknown', createUnknownLocation],
  ])('can target the distinct %s state', (status, factory) => {
    expect(
      decideFilterAction({ allowlistKey: 'x', location: factory() }, { other: { hide: [status] } }),
    ).toBe('hide');
  });

  it('does not match country or region rules for unknown states', () => {
    for (const location of [
      createHiddenLocation(),
      createMissingLocation(),
      createUnavailableLocation(),
      createUnknownLocation(),
    ]) {
      expect(
        decideFilterAction(
          { location },
          { country: { hide: ['CA'] }, region: { hide: ['NORTH_AMERICA'] } },
        ),
      ).toBe('show');
    }
  });

  it('is unaffected by duplicate rules', () => {
    expect(decideFilterAction(subject, { country: { hide: ['CA', 'CA', 'ca'] } })).toBe('hide');
  });

  it('does not mutate inputs', () => {
    const frozenSubject = Object.freeze({ location: canada, tags: Object.freeze(['news']) });
    const settings = Object.freeze({ tag: Object.freeze({ highlight: Object.freeze(['news']) }) });
    expect(decideFilterAction(frozenSubject, settings)).toBe('highlight');
    expect(settings.tag.highlight).toEqual(['news']);
  });

  it('throws a clear validation error for malformed settings', () => {
    expect(() => decideFilterAction(subject, { country: ['CA'] })).toThrow(TypeError);
    expect(() => decideFilterAction(subject, { country: { hide: 'CA' } })).toThrow(
      'country.hide must be an array or Set',
    );
  });
});
