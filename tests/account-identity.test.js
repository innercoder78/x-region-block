import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_IDENTITY_SOURCES,
  RESERVED_X_ROUTE_SEGMENTS,
  createAccountIdentity,
  normalizeXHandle,
  parseXAccountReference,
} from '../src/shared/account-identity.js';

describe('normalizeXHandle', () => {
  it.each([
    ['OpenAI', 'openai'],
    [' @OpenAI ', 'openai'],
    ['a', 'a'],
    ['123_ABC', '123_abc'],
    ['abcdefghijklmno', 'abcdefghijklmno'],
  ])('normalizes %j', (input, expected) => expect(normalizeXHandle(input)).toBe(expected));

  it.each([
    null,
    123,
    '',
    ' ',
    'abcdefghijklmnop',
    'two words',
    'a/b',
    '@@openai',
    'open@ai',
    'open.ai',
    'open\nai',
    'https://x.com/openai',
    '\u043epenai',
  ])('rejects invalid input without echoing it: %j', (input) => {
    expect(() => normalizeXHandle(input)).toThrow(TypeError);
    try {
      normalizeXHandle(input);
    } catch (error) {
      if (typeof input === 'string' && input.length > 2) expect(error.message).not.toContain(input);
    }
  });
});

describe('createAccountIdentity', () => {
  it('creates the exact deeply immutable canonical shape without mutating input', () => {
    const input = {
      handle: '@OpenAI',
      accountId: ' 00090071992547409931234 ',
      source: ' PROFILE ',
      token: 'secret',
      avatarUrl: 'https://example.test/private.png',
      metadata: { cookie: 'secret' },
    };
    const snapshot = structuredClone(input);
    const identity = createAccountIdentity(input);

    expect(identity).toEqual({
      handle: 'openai',
      displayHandle: '@openai',
      profileUrl: 'https://x.com/openai',
      accountId: '00090071992547409931234',
      allowlistKey: '@openai',
      source: 'profile',
    });
    expect(Object.keys(identity)).toEqual([
      'handle',
      'displayHandle',
      'profileUrl',
      'accountId',
      'allowlistKey',
      'source',
    ]);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(input).toEqual(snapshot);
    expect(identity).not.toHaveProperty('token');
    expect(identity).not.toHaveProperty('avatarUrl');
    expect(identity).not.toHaveProperty('metadata');
  });

  it('defaults optional fields to null', () => {
    expect(createAccountIdentity({ handle: 'X' })).toMatchObject({ accountId: null, source: null });
  });

  it.each([123, 1n, '', ' ', '-1', '1.2', '1e3', '12x'])('rejects invalid account IDs', (accountId) => {
    expect(() => createAccountIdentity({ handle: 'x', accountId })).toThrow(TypeError);
  });

  it.each([
    '',
    '   ',
    4,
    {},
    [],
    'Authorization: Bearer secret',
    'cookie=session-secret',
    'token=secret',
    'request headers',
    'account metadata',
    'https://example.test/source',
    'unknown',
  ])('rejects invalid sources', (source) => {
    expect(() => createAccountIdentity({ handle: 'x', source })).toThrow(TypeError);
  });

  it('exports a frozen set of safe observation contexts', () => {
    expect(Object.isFrozen(ACCOUNT_IDENTITY_SOURCES)).toBe(true);
    expect(ACCOUNT_IDENTITY_SOURCES).toEqual([
      'profile',
      'timeline',
      'reply',
      'search',
      'notification',
    ]);
  });
});

describe('parseXAccountReference', () => {
  it.each([
    ['OpenAI', undefined],
    ['@OpenAI', undefined],
    ['https://x.com/OpenAI', undefined],
    ['https://twitter.com/OpenAI', undefined],
    ['https://X.COM/OpenAI/status/123', undefined],
    ['HTTPS://X.COM/OpenAI', undefined],
    ['https://x.com/OpenAI/media', undefined],
    ['https://x.com/OpenAI/with_replies', undefined],
    ['https://twitter.com/OpenAI/status/123?utm_source=test#fragment', undefined],
    ['/OpenAI', { baseUrl: 'https://x.com' }],
    ['/OpenAI', { baseUrl: 'HTTPS://X.COM' }],
    ['/OpenAI', { baseUrl: 'https://twitter.com/base' }],
    ['/OpenAI', { baseUrl: new URL('https://x.com/base') }],
    ['/OpenAI/status/123', { baseUrl: new URL('https://twitter.com/base') }],
  ])('parses supported reference %s', (reference, options) => {
    expect(parseXAccountReference(reference, options)).toEqual({
      handle: 'openai',
      displayHandle: '@openai',
      profileUrl: 'https://x.com/openai',
      accountId: null,
      allowlistKey: '@openai',
      source: null,
    });
  });

  it('decodes a path segment safely', () => {
    expect(parseXAccountReference('https://x.com/Open%41I').handle).toBe('openai');
  });

  it.each([
    '/OpenAI',
    '//x.com/OpenAI',
    'https://x.com',
    'https://x.com/',
    'https://x.com/home',
    'https://x.com/EXPLORE',
    'https://x.com/i/status/123',
    'https://example.com/OpenAI',
    'https://x.com.example.com/OpenAI',
    'https://mobile.x.com/OpenAI',
    'https://user@x.com/OpenAI',
    'https://x.com:444/OpenAI',
    'http://x.com/OpenAI',
    'javascript:alert(1)',
    'data:text/plain,OpenAI',
    'https://x.com/%ZZ',
    'https://x.com/OpenAI/status/%ZZ',
    'https://x.com/open.ai',
    'https:x.com/OpenAI',
    'https:/x.com/OpenAI',
    'https:////x.com/OpenAI',
    'https:\\x.com\\OpenAI',
    'https://x.com\\OpenAI',
    '/OpenAI\\status/123',
  ])('returns null for unsupported or non-account URL %s', (reference) => {
    expect(parseXAccountReference(reference)).toBeNull();
  });

  it('rejects relative paths when the explicit base is unsafe', () => {
    for (const baseUrl of [
      'https://mobile.x.com',
      'http://x.com',
      'https:x.com',
      'https:/x.com',
      'https:////x.com',
      'https:\\x.com',
      'https://x.com\\base',
    ]) {
      expect(parseXAccountReference('/OpenAI', { baseUrl })).toBeNull();
    }
  });

  it('exposes one frozen reserved route definition', () => {
    expect(Object.isFrozen(RESERVED_X_ROUTE_SEGMENTS)).toBe(true);
    expect(RESERVED_X_ROUTE_SEGMENTS).toEqual(expect.arrayContaining(['home', 'i', 'jobs']));
  });

  it('has no browser, network, storage, messaging, navigation, or timer side effects', () => {
    const fetchSpy = vi.fn();
    const timerSpy = vi.fn();
    const browser = globalThis.browser;
    const fetch = globalThis.fetch;
    const setTimeout = globalThis.setTimeout;
    globalThis.browser = { storage: { local: { set: vi.fn() } }, runtime: { sendMessage: vi.fn() } };
    globalThis.fetch = fetchSpy;
    globalThis.setTimeout = timerSpy;
    try {
      expect(parseXAccountReference('https://x.com/OpenAI/status/1').handle).toBe('openai');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(timerSpy).not.toHaveBeenCalled();
      expect(globalThis.browser.storage.local.set).not.toHaveBeenCalled();
      expect(globalThis.browser.runtime.sendMessage).not.toHaveBeenCalled();
    } finally {
      globalThis.browser = browser;
      globalThis.fetch = fetch;
      globalThis.setTimeout = setTimeout;
    }
  });
});
