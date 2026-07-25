import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_LINK_READER_VERSION,
  readXAccountIdentityFromLink,
} from '../src/content/account-link-reader.js';

function anchor(href, baseURI = 'https://x.com/home') {
  const attributes = new Map();
  if (href !== undefined) attributes.set('href', href);
  return {
    tagName: 'A',
    ownerDocument: { baseURI },
    attributes,
    getAttribute: vi.fn((name) => attributes.get(name) ?? null),
  };
}

const canonical = (source = null) => ({
  handle: 'openai',
  displayHandle: '@openai',
  profileUrl: 'https://x.com/openai',
  accountId: null,
  allowlistKey: '@openai',
  source,
});

describe('account link reader validation', () => {
  it('exports reader version 1', () => expect(ACCOUNT_LINK_READER_VERSION).toBe(1));

  it.each([null, undefined, 1, 'link', true, Symbol('link'), [], {}, { tagName: 'DIV' }])(
    'rejects invalid link %j',
    (link) => expect(() => readXAccountIdentityFromLink(link)).toThrowError(
      new TypeError('Invalid X account link'),
    ),
  );

  it.each([
    { tagName: 'A', getAttribute() {} },
    { tagName: 'A', ownerDocument: null, getAttribute() {} },
    { tagName: 'A', ownerDocument: {} },
    { tagName: 'A', ownerDocument: {}, getAttribute: 'href' },
  ])('rejects an incomplete anchor-like object', (link) => {
    expect(() => readXAccountIdentityFromLink(link)).toThrow('Invalid X account link');
  });

  it('accepts disconnected and cross-document anchor-like objects', () => {
    const otherDocument = { baseURI: 'https://twitter.com/search?q=test' };
    const link = anchor('/OpenAI');
    link.ownerDocument = otherDocument;
    link.isConnected = false;
    expect(readXAccountIdentityFromLink(link)).toEqual(canonical());
  });

  it.each([null, 1, 'options', true, []])('rejects invalid options %j', (options) => {
    expect(() => readXAccountIdentityFromLink(anchor('/OpenAI'), options)).toThrowError(
      new TypeError('Invalid account link options'),
    );
  });

  it('rejects an own accountId option', () => {
    expect(() => readXAccountIdentityFromLink(anchor('/OpenAI'), { accountId: null }))
      .toThrow('accountId is not supported by the account link reader');
  });
});

describe('raw href handling', () => {
  it('reads only getAttribute with the href name', () => {
    const link = anchor('/OpenAI');
    Object.defineProperty(link, 'href', { get: () => { throw new Error('normalized href read'); } });
    for (const property of ['textContent', 'innerText', 'title', 'className', 'dataset', 'ariaLabel']) {
      Object.defineProperty(link, property, { get: () => { throw new Error(`${property} read`); } });
    }
    expect(readXAccountIdentityFromLink(link)).toEqual(canonical());
    expect(link.getAttribute).toHaveBeenCalledOnce();
    expect(link.getAttribute).toHaveBeenCalledWith('href');
  });

  it.each([undefined, null, '', '   ', 42, {}, []])('returns null for href %j', (href) => {
    expect(readXAccountIdentityFromLink(anchor(href))).toBeNull();
  });

  it('returns null when getAttribute throws without logging', () => {
    const link = anchor('/OpenAI');
    link.getAttribute = () => { throw new Error('secret raw value'); };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(readXAccountIdentityFromLink(link)).toBeNull();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe('supported account links', () => {
  it.each([
    ['https://x.com/OpenAI', undefined],
    ['https://twitter.com/OpenAI', undefined],
    ['HTTPS://X.COM/OpenAI', undefined],
    ['/OpenAI', undefined],
    ['/OpenAI/status/123', undefined],
    ['/OpenAI/with_replies', undefined],
    ['/OpenAI/media', undefined],
    ['/OpenAI?ref=test', undefined],
    ['/OpenAI#fragment', undefined],
    ['/OpenAI/status/123?ref=example#fragment', { source: 'timeline' }],
    ['/OpenAI', { baseUrl: 'https://twitter.com/search?q=test' }],
    ['/OpenAI', { baseUrl: 'HTTPS://X.COM' }],
  ])('canonicalizes %s', (href, options) => {
    expect(readXAccountIdentityFromLink(anchor(href), options)).toEqual(
      canonical(options?.source ?? null),
    );
  });

  it('returns the exact deeply immutable canonical identity shape', () => {
    const identity = readXAccountIdentityFromLink(anchor('/OpenAI'), { source: ' TIMELINE ' });
    expect(identity).toEqual(canonical('timeline'));
    expect(Object.keys(identity)).toEqual([
      'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
    ]);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('does not need a base for an absolute link', () => {
    expect(readXAccountIdentityFromLink(anchor('https://x.com/OpenAI', undefined))).toEqual(canonical());
  });

  it('uses an explicit base instead of a document base', () => {
    expect(readXAccountIdentityFromLink(anchor('/OpenAI', 'https://example.com'), {
      baseUrl: 'https://x.com/home',
    })).toEqual(canonical());
    expect(readXAccountIdentityFromLink(anchor('/OpenAI', 'https://x.com'), {
      baseUrl: 'https://example.com',
    })).toBeNull();
  });

  it('surfaces shared source validation only after identifying an account', () => {
    expect(() => readXAccountIdentityFromLink(anchor('/OpenAI'), { source: 'token=secret' }))
      .toThrow('Invalid account source');
    expect(readXAccountIdentityFromLink(anchor('/home'), { source: 'token=secret' })).toBeNull();
  });
});

describe('unsupported links', () => {
  it.each([
    'OpenAI', '@OpenAI', './OpenAI', '../OpenAI', '//x.com/OpenAI',
    'http://x.com/OpenAI', 'https:x.com/OpenAI', 'https:/x.com/OpenAI',
    'https:////x.com/OpenAI', 'https:\\x.com\\OpenAI', 'x.com/OpenAI',
    'javascript:alert(1)', 'data:text/plain,test',
  ])('rejects raw syntax %s', (href) => {
    expect(readXAccountIdentityFromLink(anchor(href))).toBeNull();
  });

  it.each([
    'https://example.com/OpenAI',
    'https://mobile.x.com/OpenAI',
    'https://mobile.twitter.com/OpenAI',
    'https://x.com.example.com/OpenAI',
    'https://user@x.com/OpenAI',
    'https://x.com:444/OpenAI',
    'https://x.com',
    'https://x.com/',
    'https://x.com/open.ai',
    'https://x.com/%ZZ',
    'https://x.com/OpenAI/status/%ZZ',
  ])('rejects unsupported URL %s', (href) => {
    expect(readXAccountIdentityFromLink(anchor(href))).toBeNull();
  });

  it.each([
    '/home', '/explore', '/notifications', '/messages', '/i/status/123', '/settings',
    '/compose/post', '/search', '/hashtag/topic', '/intent/follow', '/login', '/logout',
    '/signup', '/privacy', '/about', '/download', '/jobs',
  ])('rejects reserved route %s', (href) => {
    expect(readXAccountIdentityFromLink(anchor(href))).toBeNull();
  });

  it.each([
    null, 'http://x.com', 'https:x.com', 'https:/x.com', 'https:////x.com',
    'https:\\x.com', 'https://mobile.x.com', 'https://x.com.example.com', 'https://example.com',
  ])('rejects unusable base %j', (baseUrl) => {
    expect(readXAccountIdentityFromLink(anchor('/OpenAI', baseUrl))).toBeNull();
  });

  it('rejects a missing document base and an explicitly undefined base', () => {
    const link = anchor('/OpenAI');
    link.ownerDocument.baseURI = undefined;
    expect(readXAccountIdentityFromLink(link)).toBeNull();
    expect(readXAccountIdentityFromLink(anchor('/OpenAI'), { baseUrl: undefined })).toBeNull();
  });
});

describe('security and isolation', () => {
  it('does not mutate or retain inputs or copy sensitive values', () => {
    const link = anchor('/OpenAI?private=secret#token');
    link.secret = { token: 'secret' };
    const options = { source: 'reply', metadata: { authorization: 'secret' } };
    const linkSnapshot = { attributes: [...link.attributes], secret: link.secret };
    const optionsSnapshot = structuredClone(options);
    const identity = readXAccountIdentityFromLink(link, options);

    expect([...link.attributes]).toEqual(linkSnapshot.attributes);
    expect(link.secret).toBe(linkSnapshot.secret);
    expect(options).toEqual(optionsSnapshot);
    expect(JSON.stringify(identity)).not.toMatch(/private|secret|token|authorization/i);
    expect(Object.values(identity)).not.toContain(link);
    expect(Object.values(identity)).not.toContain(options);
  });

  it('performs no page, platform, scheduling, observation, or logging activity', () => {
    const spies = {
      querySelector: vi.fn(), createElement: vi.fn(), fetch: vi.fn(), navigate: vi.fn(),
      storage: vi.fn(), sendMessage: vi.fn(), setTimeout: vi.fn(), observer: vi.fn(),
      addEventListener: vi.fn(), renderer: vi.fn(), log: vi.fn(), error: vi.fn(),
    };
    const oldDocument = globalThis.document;
    const oldWindow = globalThis.window;
    const oldFetch = globalThis.fetch;
    const oldBrowser = globalThis.browser;
    const oldSetTimeout = globalThis.setTimeout;
    const oldObserver = globalThis.MutationObserver;
    globalThis.document = { querySelector: spies.querySelector, createElement: spies.createElement };
    globalThis.window = { location: { assign: spies.navigate }, addEventListener: spies.addEventListener };
    globalThis.fetch = spies.fetch;
    globalThis.browser = { storage: { local: { set: spies.storage } }, runtime: { sendMessage: spies.sendMessage } };
    globalThis.setTimeout = spies.setTimeout;
    globalThis.MutationObserver = spies.observer;
    const log = vi.spyOn(console, 'log').mockImplementation(spies.log);
    const error = vi.spyOn(console, 'error').mockImplementation(spies.error);
    try {
      expect(readXAccountIdentityFromLink(anchor('/OpenAI'))).toEqual(canonical());
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      globalThis.document = oldDocument;
      globalThis.window = oldWindow;
      globalThis.fetch = oldFetch;
      globalThis.browser = oldBrowser;
      globalThis.setTimeout = oldSetTimeout;
      globalThis.MutationObserver = oldObserver;
    }
  });
});
