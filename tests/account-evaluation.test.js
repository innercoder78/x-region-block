import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_EVALUATION_VERSION,
  evaluateXAccountLink,
} from '../src/content/account-evaluation.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { createSettingsRuntime } from '../src/shared/settings-runtime.js';

function anchor(href, baseURI = 'https://x.com/home') {
  const attributes = new Map();
  if (href !== undefined) attributes.set('href', href);
  return {
    tagName: 'A',
    ownerDocument: { baseURI },
    getAttribute: vi.fn((name) => attributes.get(name) ?? null),
  };
}

const known = (countryCode = 'CA', countryName = 'Canada') => ({
  status: 'known', countryCode, countryName,
});
const settings = (overrides = {}) => normalizeSettings({ schemaVersion: 2, ...overrides });
const evaluate = (observation = {}, configured = {}) => evaluateXAccountLink(
  anchor('/OpenAI'),
  { location: known(), ...observation },
  settings(configured),
);

describe('account evaluation API and ordering', () => {
  it('exports version 1 and returns the exact immutable result shape', () => {
    const result = evaluate({ source: ' TIMELINE ' });
    expect(ACCOUNT_EVALUATION_VERSION).toBe(1);
    expect(Object.keys(result)).toEqual(['version', 'subject', 'action', 'display']);
    expect(result.version).toBe(1);
    expect(result.subject.identity.source).toBe('timeline');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.subject)).toBe(true);
    expect(Object.isFrozen(result.display)).toBe(true);
  });

  it('accepts ordinary and null-prototype observations', () => {
    const observation = Object.assign(Object.create(null), { location: known() });
    expect(evaluateXAccountLink(anchor('/OpenAI'), observation, settings()).action).toBe('show');
    expect(evaluate().action).toBe('show');
  });

  it.each([null, undefined, 1, 'value', true, [], () => {}, new (class Observation {})()])(
    'rejects a non-plain observation',
    (observation) => expect(() => evaluateXAccountLink(anchor('/OpenAI'), observation, settings()))
      .toThrowError(new TypeError('account observation must be a plain object')),
  );

  it('rejects only an own accountId', () => {
    expect(() => evaluate({ accountId: null })).toThrow(
      'accountId is not supported by account evaluation',
    );
    Object.defineProperty(Object.prototype, 'accountId', { value: undefined, configurable: true });
    try {
      expect(evaluateXAccountLink(anchor('/OpenAI'), { location: known() }, settings()).action)
        .toBe('show');
    } finally {
      delete Object.prototype.accountId;
    }
  });

  it('preserves reader link validation and accepts disconnected cross-document links', () => {
    expect(() => evaluateXAccountLink({}, {}, settings())).toThrow('Invalid X account link');
    const link = anchor('/OpenAI');
    link.ownerDocument = { baseURI: 'https://twitter.com/search' };
    link.isConnected = false;
    expect(evaluateXAccountLink(link, { location: known() }, settings()).subject.identity.handle)
      .toBe('openai');
  });

  it.each(['/home', 'https://example.com/OpenAI', 'OpenAI', undefined])(
    'returns null for unsupported link %s before unrelated validation',
    (href) => {
      const observation = {};
      for (const field of ['location', 'languages', 'tags']) {
        Object.defineProperty(observation, field, { get: () => { throw new Error(`${field} read`); } });
      }
      expect(evaluateXAccountLink(anchor(href), observation, { malformed: true })).toBeNull();
    },
  );

  it('requires an own location only after identifying an account', () => {
    expect(() => evaluateXAccountLink(anchor('/OpenAI'), {}, settings()))
      .toThrow('account observation location is required');
    Object.defineProperty(Object.prototype, 'location', { value: known(), configurable: true });
    try {
      expect(() => evaluateXAccountLink(anchor('/OpenAI'), {}, settings()))
        .toThrow('account observation location is required');
    } finally {
      delete Object.prototype.location;
    }
  });

  it('preserves source-validation ordering', () => {
    expect(() => evaluate({ source: 'token=secret' })).toThrow('Invalid account source');
    expect(evaluateXAccountLink(
      anchor('/home'), { source: 'token=secret' }, { malformed: true },
    )).toBeNull();
  });
});

describe('base URL ownership', () => {
  it('supports absolute links and document or explicit supported bases', () => {
    expect(evaluateXAccountLink(
      anchor('https://x.com/OpenAI', undefined), { location: known() }, settings(),
    )).not.toBeNull();
    expect(evaluateXAccountLink(anchor('/OpenAI', 'https://twitter.com'), {
      location: known(),
    }, settings())).not.toBeNull();
    expect(evaluateXAccountLink(anchor('/OpenAI', 'https://example.com'), {
      location: known(), baseUrl: 'https://x.com/home',
    }, settings())).not.toBeNull();
  });

  it.each(['https://example.com', 'not a url', undefined])(
    'does not fall back from an own unusable base %s',
    (baseUrl) => expect(evaluateXAccountLink(anchor('/OpenAI', 'https://x.com'), {
      location: known(), baseUrl,
    }, settings())).toBeNull(),
  );

  it('ignores inherited reader options', () => {
    Object.defineProperties(Object.prototype, {
      baseUrl: { value: 'https://example.com', configurable: true },
      source: { value: 'reply', configurable: true },
    });
    try {
      const result = evaluateXAccountLink(
        anchor('/OpenAI', 'https://x.com'), { location: known() }, settings(),
      );
      expect(result.subject.identity.source).toBeNull();
    } finally {
      delete Object.prototype.baseUrl;
      delete Object.prototype.source;
    }
  });
});

describe('canonical subject, filter, and display composition', () => {
  it('canonicalizes identity and location without removed or extra keys', () => {
    const result = evaluate({
      location: { ...known(), rawLocation: ' Canada ', source: 'caller', secret: 'discard' },
      languages: [' EN ', 'fr', 'en'], tags: [' News ', 'TECH', 'news'], extra: 'discard',
    });
    expect(result.subject.identity).toMatchObject({
      handle: 'openai', allowlistKey: '@openai', profileUrl: 'https://x.com/openai',
    });
    expect(result.subject.location).toMatchObject({
      status: 'known', countryCode: 'CA', regionCode: 'NORTH_AMERICA',
    });
    expect(Object.keys(result.subject)).toEqual([
      'identity', 'allowlistKey', 'location',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|discard/i);
  });

  it.each([
    ['allowlist', { allowlist: ['@openai'], country: { hide: ['CA'] } }, 'show'],
    ['always show', { country: { alwaysShow: ['CA'] }, region: { hide: ['NORTH_AMERICA'] } }, 'show'],
    ['country hide', { country: { hide: ['CA'] }, language: { highlight: ['en'] } }, 'hide'],
    ['region hide', { region: { hide: ['NORTH_AMERICA'] }, tag: { highlight: ['news'] } }, 'hide'],
    ['country highlight', { country: { highlight: ['CA'] } }, 'highlight'],
    ['region highlight', { region: { highlight: ['NORTH_AMERICA'] } }, 'highlight'],
    ['default', {}, 'show'],
  ])('preserves %s precedence', (_name, configured, action) => {
    expect(evaluate({ languages: ['en'], tags: ['news'] }, configured).action).toBe(action);
  });

  it.each(['hidden', 'missing', 'unavailable', 'unknown'])('preserves the %s state', (status) => {
    const result = evaluate({ location: { status } }, { other: { hide: [status], highlight: [status] } });
    expect(result.action).toBe('hide');
    expect(result.display.status).toBe(status);
    expect(result.display.region.label).toMatch(/Location/);
  });

  it('creates display from canonical location and handles Antarctica', () => {
    const canada = evaluate();
    expect(canada.display.country.symbol).toBe('🇨🇦');
    expect(canada.display.region.label).toBe('North America');
    expect(canada.display).not.toHaveProperty('rawLocation');
    expect(canada.display).not.toHaveProperty('source');

    const antarctica = evaluate({ location: known('AQ', 'Antarctica') }, {
      region: { hide: ['NORTH_AMERICA'] },
    });
    expect(antarctica.action).toBe('show');
    expect(antarctica.display.country.symbol).toBe('🇦🇶');
    expect(antarctica.display.region.label).toBe('Unknown region');
  });

  it.each([
    ['ZA', 'South Africa', 'Africa'],
    ['JP', 'Japan', 'Asia'],
    ['FR', 'France', 'Europe'],
    ['AE', 'United Arab Emirates', 'Middle East'],
    ['CA', 'Canada', 'North America'],
    ['AU', 'Australia', 'Oceania'],
    ['BR', 'Brazil', 'South America'],
    ['JM', 'Jamaica', 'Caribbean'],
    ['CR', 'Costa Rica', 'Central America'],
  ])('preserves the configured display region for %s', (code, name, region) => {
    expect(evaluate({ location: known(code, name) }).display.region.label).toBe(region);
  });

  it('propagates malformed observed values and settings', () => {
    expect(() => evaluate({ location: { status: 'invalid' } })).toThrow(TypeError);
    expect(evaluate({ languages: 'ignored', tags: [null] }).action).toBe('show');
    expect(() => evaluateXAccountLink(anchor('/OpenAI'), { location: known() }, { country: [] }))
      .toThrow(TypeError);
  });

  it('accepts a settings-runtime snapshot directly', async () => {
    const snapshot = settings({ country: { highlight: ['CA'] } });
    const runtime = createSettingsRuntime({
      repository: { initializeSettings: vi.fn().mockResolvedValue(snapshot) },
      changeAdapter: { subscribe: vi.fn(() => vi.fn()) },
      onError: vi.fn(),
    });
    await runtime.start();
    expect(evaluateXAccountLink(
      anchor('/OpenAI'), { location: known(), languages: ['EN'] }, runtime.getSettings(),
    ).action).toBe('highlight');
    runtime.stop();
  });
});

describe('isolation', () => {
  it('does not mutate or retain inputs and returns fresh equivalent results', () => {
    const link = anchor('/OpenAI?secret=yes');
    const location = Object.freeze(known());
    const observation = Object.freeze({ location, languages: Object.freeze(['EN']), token: 'secret' });
    const configured = settings();
    const before = structuredClone(configured);
    const first = evaluateXAccountLink(link, observation, configured);
    const second = evaluateXAccountLink(link, observation, configured);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(configured).toEqual(before);
    expect(Object.values(first)).not.toContain(link);
    expect(Object.values(first)).not.toContain(observation);
    expect(JSON.stringify(first)).not.toMatch(/token|secret|href/i);
  });

  it('performs no ambient page or platform activity', () => {
    const oldDocument = globalThis.document;
    const oldFetch = globalThis.fetch;
    const oldObserver = globalThis.MutationObserver;
    const querySelector = vi.fn();
    const createElement = vi.fn();
    const fetch = vi.fn();
    const observer = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.document = { querySelector, createElement };
    globalThis.fetch = fetch;
    globalThis.MutationObserver = observer;
    try {
      expect(evaluate()).not.toBeNull();
      expect(querySelector).not.toHaveBeenCalled();
      expect(createElement).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(observer).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      globalThis.document = oldDocument;
      globalThis.fetch = oldFetch;
      globalThis.MutationObserver = oldObserver;
    }
  });
});
