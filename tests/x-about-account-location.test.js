import { describe, expect, it } from 'vitest';
import {
  X_ABOUT_ACCOUNT_LOCATION_PARSER_VERSION, X_ABOUT_ACCOUNT_LOCATION_SOURCE,
  parseXAboutAccountLocationPayload,
} from '../src/shared/x-about-account-location.js';

const payload = (accountBasedIn, extra = {}) => ({
  data: { user_result_by_screen_name: { result: { about_profile: {
    account_based_in: accountBasedIn, ...extra,
  } } } },
});
const parse = (value, extra) => parseXAboutAccountLocationPayload(payload(value, extra));

const known = [
  ['United States', 'US', 'United States', 'NORTH_AMERICA'],
  ['United Kingdom', 'GB', 'United Kingdom', 'EUROPE'], ['Canada', 'CA', 'Canada', 'NORTH_AMERICA'],
  ['Japan', 'JP', 'Japan', 'ASIA'], ['South Korea', 'KR', 'South Korea', 'ASIA'],
  ['Türkiye', 'TR', 'Türkiye', 'MIDDLE_EAST'], ['Côte d’Ivoire', 'CI', 'Côte d’Ivoire', 'AFRICA'],
  ['Democratic Republic of the Congo', 'CD', 'Democratic Republic of the Congo', 'AFRICA'],
  ['Palestine', 'PS', 'Palestine', 'MIDDLE_EAST'], ['Hong Kong', 'HK', 'Hong Kong', 'ASIA'],
  ['Australia', 'AU', 'Australia', 'OCEANIA'], ['Brazil', 'BR', 'Brazil', 'SOUTH_AMERICA'],
  ['Jamaica', 'JM', 'Jamaica', 'CARIBBEAN'], ['Costa Rica', 'CR', 'Costa Rica', 'CENTRAL_AMERICA'],
  ['Saint Martin (French part)', 'MF', 'Saint Martin (French part)', 'CARIBBEAN'],
  ['Sint Maarten', 'SX', 'Sint Maarten', 'CARIBBEAN'],
];

it('exports the versioned parser contract', () => {
  expect(X_ABOUT_ACCOUNT_LOCATION_PARSER_VERSION).toBe(1);
  expect(X_ABOUT_ACCOUNT_LOCATION_SOURCE).toBe('x-about-account');
});

describe('payload validation', () => {
  it.each([null, undefined, [], 1, 'x', true, () => {}, new (class Example {})()])(
    'rejects non-plain payload %s', (value) => expect(() => parseXAboutAccountLocationPayload(value))
      .toThrow(new TypeError('X About Account payload must be a plain object')),
  );

  it('accepts ordinary, null-prototype, and frozen payloads without mutation or freezing inputs', () => {
    expect(parseXAboutAccountLocationPayload({}).status).toBe('unavailable');
    const nullPrototype = Object.create(null);
    expect(parseXAboutAccountLocationPayload(nullPrototype).status).toBe('unavailable');
    const input = payload('Canada');
    const before = structuredClone(input);
    expect(parseXAboutAccountLocationPayload(input).status).toBe('known');
    expect(input).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(parseXAboutAccountLocationPayload(Object.freeze(payload('Japan'))).status).toBe('known');
  });
});

describe('status mapping', () => {
  it.each(known)('canonicalizes known %s', (raw, code, name, regionCode) => {
    const result = parse(`  ${raw}  `);
    expect(result).toEqual({ status: 'known', countryCode: code, countryName: name, regionCode,
      regionName: expect.any(String), rawLocation: raw, source: 'x-about-account' });
    expect(Object.keys(result)).toEqual(['status', 'countryCode', 'countryName', 'regionCode',
      'regionName', 'rawLocation', 'source']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps Antarctica known with no configurable region', () => {
    expect(parse('Antarctica')).toEqual({ status: 'known', countryCode: 'AQ', countryName: 'Antarctica',
      regionCode: null, regionName: null, rawLocation: 'Antarctica', source: 'x-about-account' });
  });

  it.each([
    ['USA', 'US', 'United States'], ['United States of America', 'US', 'United States'],
    ['Great Britain', 'GB', 'United Kingdom'], ['Republic of Korea', 'KR', 'South Korea'],
    ['Turkey', 'TR', 'Türkiye'], ['Viet Nam', 'VN', 'Vietnam'], ['Czech Republic', 'CZ', 'Czechia'],
    ['Ivory Coast', 'CI', 'Côte d’Ivoire'], ['Cape Verde', 'CV', 'Cabo Verde'],
    ['Swaziland', 'SZ', 'Eswatini'], ['East Timor', 'TL', 'Timor-Leste'],
    ['State of Palestine', 'PS', 'Palestine'], ['Macau', 'MO', 'Macao'],
    ['The Gambia', 'GM', 'Gambia'], ['DR Congo', 'CD', 'Democratic Republic of the Congo'],
  ])('canonicalizes alias %s', (alias, code, name) => {
    expect(parse(alias)).toMatchObject({ status: 'known', countryCode: code, countryName: name, rawLocation: alias });
  });

  it.each([undefined, null, '', ' \t\n '])('maps missing value %s to missing', (value) => {
    const result = parse(value);
    expect(result).toMatchObject({ status: 'missing', rawLocation: null, source: 'x-about-account' });
  });
  it('maps an absent property to missing', () => {
    const input = payload(undefined);
    delete input.data.user_result_by_screen_name.result.about_profile.account_based_in;
    expect(parseXAboutAccountLocationPayload(input).status).toBe('missing');
  });

  it.each(['Unknown', 'Worldwide', 'Earth', 'Europe', 'Congo', 'US', 'Saint Martin', 'St. Martin',
    'United States App Store', '<Example>', '"><img src=x onerror=alert(1)>',
    'United States extra', 'United', 'Deutschland',
  ])('preserves unknown value %s literally', (value) => {
    const result = parse(`  ${value}  `);
    expect(result).toMatchObject({ status: 'unknown', rawLocation: value, countryCode: null });
  });
});

describe('malformed response isolation', () => {
  it.each([
    {}, { data: {} }, { data: { user_result_by_screen_name: {} } },
    { data: { user_result_by_screen_name: { result: {} } } }, { errors: [{ message: 'secret' }] },
    { account_based_in: 'Canada' }, { data: { result: { about_profile: { account_based_in: 'Canada' } } } },
  ])('returns unavailable for unsupported path %#', (input) => {
    expect(parseXAboutAccountLocationPayload(input)).toMatchObject({ status: 'unavailable', rawLocation: null });
  });

  it.each([null, [], 1, 'Canada'])('returns unavailable for unusable about_profile %s', (aboutProfile) => {
    const input = payload('Canada');
    input.data.user_result_by_screen_name.result.about_profile = aboutProfile;
    expect(parseXAboutAccountLocationPayload(input).status).toBe('unavailable');
  });
  it.each([1, true, {}, [], () => {}])('returns unavailable for non-string location %s', (value) => {
    expect(parse(value).status).toBe('unavailable');
  });

  it.each(['data', 'user_result_by_screen_name', 'result', 'about_profile', 'account_based_in'])(
    'contains throwing getter at %s', (throwAt) => {
      const input = payload('Canada');
      const parents = { data: input, user_result_by_screen_name: input.data,
        result: input.data.user_result_by_screen_name,
        about_profile: input.data.user_result_by_screen_name.result,
        account_based_in: input.data.user_result_by_screen_name.result.about_profile };
      Object.defineProperty(parents[throwAt], throwAt, { get() { throw new Error('external secret'); } });
      expect(() => parseXAboutAccountLocationPayload(input)).not.toThrow();
      expect(parseXAboutAccountLocationPayload(input).status).toBe('unavailable');
    },
  );
});

describe('accuracy independence and minimization', () => {
  it.each([true, false, null, undefined, { malformed: true }])('ignores location_accurate %s', (value) => {
    const result = parse('Canada', { location_accurate: value });
    expect(result.status).toBe('known');
    expect(result).not.toHaveProperty('location_accurate');
  });

  it('returns only the location model and fixed source', () => {
    const input = payload('Canada', { source: 'device-secret', learn_more_url: 'secret', username_changes: 9 });
    Object.assign(input, { requestId: 'secret', errors: ['secret'], token: 'secret', cookie: 'secret', headers: 'secret' });
    Object.assign(input.data.user_result_by_screen_name.result, {
      user_id: 'secret', screen_name: 'secret', avatar: 'secret', verification: 'secret',
      affiliate_username: 'secret',
    });
    const serialized = JSON.stringify(parseXAboutAccountLocationPayload(input));
    expect(serialized).not.toMatch(/device-secret|learn_more|username|user_id|screen_name|avatar|verification|affiliate|requestId|errors|token|cookie|headers|secret/);
  });
});
