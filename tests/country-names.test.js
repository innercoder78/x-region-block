import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../src/shared/country-regions.js';
import {
  COUNTRY_NAME_ALIASES, COUNTRY_NAME_POLICY_VERSION, COUNTRY_NAMES_BY_CODE,
  getCountryCodeByName, getCountryName, normalizeCountryName,
} from '../src/shared/country-names.js';

const difficultNames = {
  US: 'United States', GB: 'United Kingdom', KR: 'South Korea', KP: 'North Korea',
  RU: 'Russia', TR: 'Türkiye', CZ: 'Czechia', CI: 'Côte d’Ivoire', CV: 'Cabo Verde',
  SZ: 'Eswatini', TL: 'Timor-Leste', PS: 'Palestine', TW: 'Taiwan', HK: 'Hong Kong',
  MO: 'Macao', CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo',
  FM: 'Micronesia', AQ: 'Antarctica',
};

const requiredAliases = {
  'United States of America': 'US', USA: 'US', 'Great Britain': 'GB', Britain: 'GB',
  'Republic of Korea': 'KR', 'Korea, Republic of': 'KR',
  'Democratic People’s Republic of Korea': 'KP',
  'Korea, Democratic People’s Republic of': 'KP', 'Russian Federation': 'RU', Turkey: 'TR',
  'Viet Nam': 'VN', 'Iran, Islamic Republic of': 'IR', 'Syrian Arab Republic': 'SY',
  'Bolivia, Plurinational State of': 'BO', 'Venezuela, Bolivarian Republic of': 'VE',
  'Tanzania, United Republic of': 'TZ', 'Moldova, Republic of': 'MD',
  'Lao People’s Democratic Republic': 'LA', 'Brunei Darussalam': 'BN',
  'Czech Republic': 'CZ', 'Ivory Coast': 'CI', "Cote d'Ivoire": 'CI',
  "Côte d'Ivoire": 'CI', 'Cape Verde': 'CV', Swaziland: 'SZ', 'East Timor': 'TL',
  'State of Palestine': 'PS', 'Palestinian Territories': 'PS',
  'Taiwan, Province of China': 'TW', 'Hong Kong SAR China': 'HK', Macau: 'MO',
  'Macao SAR China': 'MO', 'The Bahamas': 'BS', 'The Gambia': 'GM',
  'Federated States of Micronesia': 'FM', 'Congo-Kinshasa': 'CD', 'DR Congo': 'CD',
  'Congo-Brazzaville': 'CG', 'Saint Barthélemy': 'BL', 'St. Barthélemy': 'BL',
  'Saint Martin (French part)': 'MF', 'Sint Maarten (Dutch part)': 'SX',
};

describe('static country-name policy', () => {
  it('is version 1 with exact deterministic 249-code coverage', () => {
    expect(COUNTRY_NAME_POLICY_VERSION).toBe(1);
    expect(Object.keys(COUNTRY_NAMES_BY_CODE)).toEqual(COUNTRY_CODES);
    expect(Object.keys(COUNTRY_NAMES_BY_CODE)).toHaveLength(249);
    expect(Object.keys(COUNTRY_NAMES_BY_CODE)).toEqual([...COUNTRY_CODES].sort());
    expect(Object.isFrozen(COUNTRY_NAMES_BY_CODE)).toBe(true);
    expect(Object.isFrozen(COUNTRY_NAME_ALIASES)).toBe(true);
  });

  it('has unique non-empty canonical names which round-trip', () => {
    const normalized = COUNTRY_CODES.map((code) => normalizeCountryName(COUNTRY_NAMES_BY_CODE[code]));
    expect(normalized.every(Boolean)).toBe(true);
    expect(new Set(normalized).size).toBe(249);
    for (const code of COUNTRY_CODES) {
      expect(getCountryCodeByName(COUNTRY_NAMES_BY_CODE[code])).toBe(code);
      expect(getCountryName(code)).toBe(COUNTRY_NAMES_BY_CODE[code]);
    }
  });

  it('uses the required difficult canonical names and represents every region and territories', () => {
    expect(COUNTRY_NAMES_BY_CODE).toMatchObject(difficultNames);
    for (const code of ['ZA', 'JP', 'FR', 'AE', 'CA', 'AU', 'BR', 'JM', 'CR', 'AQ', 'AX', 'GF', 'GU']) {
      expect(getCountryCodeByName(getCountryName(code))).toBe(code);
    }
  });

  it('resolves every deliberate alias without cross-country conflicts', () => {
    expect(COUNTRY_NAME_ALIASES).toMatchObject(requiredAliases);
    const seen = new Map();
    for (const [name, code] of Object.entries(COUNTRY_NAME_ALIASES)) {
      expect(COUNTRY_CODES).toContain(code);
      expect(getCountryCodeByName(name)).toBe(code);
      const normalized = normalizeCountryName(name);
      expect(seen.get(normalized) ?? code).toBe(code);
      seen.set(normalized, code);
      const canonicalCode = COUNTRY_CODES.find(
        (candidate) => normalizeCountryName(getCountryName(candidate)) === normalized,
      );
      expect(canonicalCode === undefined || canonicalCode === code).toBe(true);
    }
  });
});

describe('country-name normalization and exact lookup', () => {
  it.each([null, undefined, 1, {}, [], true])('rejects non-string %s', (value) => {
    expect(() => normalizeCountryName(value)).toThrow(new TypeError('country name must be a string'));
  });

  it('normalizes NFKC, whitespace, apostrophes, dashes, and case deterministically', () => {
    expect(normalizeCountryName('  Ｕｎｉｔｅｄ\t States  ')).toBe('united states');
    expect(getCountryCodeByName('uNiTeD\n  sTaTeS')).toBe('US');
    expect(getCountryCodeByName("Côte d'Ivoire")).toBe('CI');
    expect(getCountryCodeByName('Côte d‘Ivoire')).toBe('CI');
    expect(getCountryCodeByName('Timor—Leste')).toBe('TL');
  });

  it.each(['', '  ', 'Cote dIvoire', 'United State', 'United', 'United States App Store',
    '<United States>', 'US', 'GB', 'UK', 'KR', 'Congo', 'Korea', 'Virgin Islands',
    'Saint Martin', 'Georgia, USA', 'America', 'Britain and Ireland', 'Turkiye',
  ])('does not guess or interpret %j', (name) => expect(getCountryCodeByName(name)).toBeNull());

  it('keeps diacritics significant and rejects unsupported country codes', () => {
    expect(getCountryCodeByName("Cote d'Ivoire")).toBe('CI');
    expect(getCountryCodeByName('Cote d’Ivoire')).toBeNull();
    expect(() => getCountryName('ZZ')).toThrow(new TypeError('Unsupported country code'));
    expect(() => getCountryName(null)).toThrow(new TypeError('Unsupported country code'));
  });
});
