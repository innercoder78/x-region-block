import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_TARGET_DISCOVERY_VERSION,
  X_ACCOUNT_DISCOVERY_SELECTORS,
  discoverXAccountPresentationTargets,
} from '../src/content/account-target-discovery.js';
import { presentXAccountLink } from '../src/content/account-presentation.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { FakeDocument, snapshot } from './helpers/fake-dom.js';

function element(document, tag, testId) {
  const value = document.createElement(tag);
  if (testId) value.setAttribute('data-testid', testId);
  return value;
}

function link(document, href) {
  const value = element(document, 'a');
  if (href !== undefined) value.setAttribute('href', href);
  return value;
}

function tweet(document, handle = 'OpenAI') {
  const surface = element(document, 'article', 'tweet');
  const name = element(document, 'div', 'User-Name');
  const accountLink = link(document, `/${handle}`);
  name.appendChild(accountLink);
  surface.appendChild(name);
  return { surface, name, accountLink };
}

function userCell(document, handle = 'OpenAI') {
  const surface = element(document, 'div', 'UserCell');
  const name = element(document, 'div', 'UserName');
  const accountLink = link(document, `/${handle}`);
  name.appendChild(accountLink);
  surface.appendChild(name);
  return { surface, name, accountLink };
}

describe('account target discovery API', () => {
  it('exports the exact deeply frozen versioned selector policy', () => {
    expect(ACCOUNT_TARGET_DISCOVERY_VERSION).toBe(1);
    expect(X_ACCOUNT_DISCOVERY_SELECTORS).toEqual({
      surfaces: {
        profile: '[data-testid="UserName"]',
        timeline: 'article[data-testid="tweet"]',
        reply: 'article[data-testid="tweet"]',
        search: '[data-testid="UserCell"]',
        notification: '[data-testid="UserCell"]',
      },
      nameContainer: '[data-testid="User-Name"], [data-testid="UserName"]',
      accountLink: 'a[href]',
    });
    expect(Object.isFrozen(X_ACCOUNT_DISCOVERY_SELECTORS)).toBe(true);
    expect(Object.isFrozen(X_ACCOUNT_DISCOVERY_SELECTORS.surfaces)).toBe(true);
  });

  it.each([null, undefined, [], {}, 1, 'root', () => {}])('rejects invalid root %j', (root) => {
    expect(() => discoverXAccountPresentationTargets(root, { source: 'profile' }))
      .toThrowError(new TypeError('Invalid account discovery root'));
  });

  it('rejects non-iterable root results but preserves query execution errors', () => {
    expect(() => discoverXAccountPresentationTargets({ querySelectorAll: () => ({}) },
      { source: 'profile' })).toThrow('Invalid account discovery root');
    const error = new Error('host selector failure');
    expect(() => discoverXAccountPresentationTargets({ querySelectorAll: () => { throw error; } },
      { source: 'profile' })).toThrow(error);
  });

  it.each([null, undefined, [], 1, 'options', () => {}, new (class Options {})()])(
    'rejects non-plain options %j',
    (options) => {
      const root = { querySelectorAll: () => [] };
      expect(() => discoverXAccountPresentationTargets(root, options))
        .toThrow('account discovery options must be a plain object');
    },
  );

  it('normalizes a null-prototype own source and rejects missing, invalid, and own accountId', () => {
    const document = new FakeDocument();
    const profile = element(document, 'div', 'UserName');
    profile.appendChild(link(document, '/OpenAI'));
    const options = Object.assign(Object.create(null), { source: ' PROFILE ' });
    expect(discoverXAccountPresentationTargets(profile, options)[0].source).toBe('profile');
    expect(() => discoverXAccountPresentationTargets(profile, {}))
      .toThrow('Invalid account discovery source');
    expect(() => discoverXAccountPresentationTargets(profile, { source: 'other' }))
      .toThrow('Invalid account discovery source');
    expect(() => discoverXAccountPresentationTargets(profile,
      { source: 'profile', accountId: undefined }))
      .toThrow('accountId is not supported by account discovery');
  });

  it('ignores inherited supported properties', () => {
    Object.defineProperties(Object.prototype, {
      source: { value: 'profile', configurable: true },
      baseUrl: { value: 'https://x.com', configurable: true },
      accountId: { value: 'secret', configurable: true },
    });
    try {
      expect(() => discoverXAccountPresentationTargets({ querySelectorAll: () => [] }, {}))
        .toThrow('Invalid account discovery source');
    } finally {
      delete Object.prototype.source;
      delete Object.prototype.baseUrl;
      delete Object.prototype.accountId;
    }
  });
});

describe('surface and identity discovery', () => {
  it('includes a matching profile root before descendants and uses exact immutable results', () => {
    const document = new FakeDocument();
    const root = element(document, 'div', 'UserName');
    const firstLink = link(document, 'https://twitter.com/OpenAI/status/1?x=1#fragment');
    root.appendChild(firstLink);
    const descendant = element(document, 'div', 'UserName');
    const descendantLink = link(document, '/OpenAI/media');
    descendant.appendChild(descendantLink);
    root.appendChild(descendant);
    const before = snapshot(root);
    const targets = discoverXAccountPresentationTargets(root, { source: ' PROFILE ' });
    expect(targets.map((target) => target.accountContainer)).toEqual([root, descendant]);
    expect(targets[0]).toEqual({
      version: 1, source: 'profile', accountContainer: root, link: firstLink,
      badgeContainer: root,
      identity: {
        handle: 'openai', displayHandle: '@openai', profileUrl: 'https://x.com/openai',
        accountId: null, allowlistKey: '@openai', source: 'profile',
      },
    });
    expect(Object.keys(targets[0])).toEqual([
      'version', 'source', 'accountContainer', 'link', 'badgeContainer', 'identity',
    ]);
    expect(Object.isFrozen(targets)).toBe(true);
    expect(Object.isFrozen(targets[0])).toBe(true);
    expect(Object.isFrozen(targets[0].identity)).toBe(true);
    expect(Object.isFrozen(root)).toBe(false);
    expect(snapshot(root)).toEqual(before);
  });

  it.each(['timeline', 'reply'])('discovers local %s tweet name containers', (source) => {
    const document = new FakeDocument();
    const { surface, name, accountLink } = tweet(document);
    surface.insertedText = 'not consulted';
    const query = vi.spyOn(surface, 'querySelectorAll');
    const [target] = discoverXAccountPresentationTargets(surface, { source });
    expect(target.accountContainer).toBe(surface);
    expect(target.badgeContainer).toBe(name);
    expect(target.link).toBe(accountLink);
    expect(query).toHaveBeenCalledWith(X_ACCOUNT_DISCOVERY_SELECTORS.nameContainer);
    expect(query).not.toHaveBeenCalledWith('a[href]');
  });

  it.each(['search', 'notification'])('discovers a document-like %s UserCell', (source) => {
    const document = new FakeDocument();
    const { surface, name } = userCell(document);
    document.appendChild(surface);
    const [target] = discoverXAccountPresentationTargets(document, { source });
    expect(target.accountContainer).toBe(surface);
    expect(target.badgeContainer).toBe(name);
  });

  it('honors per-link document bases and explicit base semantics', () => {
    const document = new FakeDocument();
    document.baseURI = 'https://twitter.com/home';
    const root = element(document, 'div', 'UserName');
    root.appendChild(link(document, '/OpenAI/with_replies'));
    expect(discoverXAccountPresentationTargets(root, { source: 'profile' })[0].identity.handle)
      .toBe('openai');
    expect(discoverXAccountPresentationTargets(root,
      { source: 'profile', baseUrl: undefined })).toEqual([]);
    expect(discoverXAccountPresentationTargets(root,
      { source: 'profile', baseUrl: 'https://example.com' })).toEqual([]);
    expect(discoverXAccountPresentationTargets(root,
      { source: 'profile', baseUrl: 'https://x.com/search' })[0].identity.handle).toBe('openai');
  });

  it('ignores unsafe, reserved, missing, malformed, and unsupported links', () => {
    const document = new FakeDocument();
    for (const href of ['/home', 'https://example.com/OpenAI', undefined, '/bad-name',
      'OpenAI', '//x.com/OpenAI', 'http://x.com/OpenAI']) {
      const root = element(document, 'div', 'UserName');
      root.appendChild(link(document, href));
      expect(discoverXAccountPresentationTargets(root, { source: 'profile' })).toEqual([]);
    }
  });
});

describe('isolation, ambiguity, and interoperability', () => {
  it('isolates nested tweets and retains separate same-account posts', () => {
    const document = new FakeDocument();
    const outer = tweet(document, 'Outer');
    const nested = tweet(document, 'Nested');
    outer.surface.appendChild(nested.surface);
    const targets = discoverXAccountPresentationTargets(outer.surface, { source: 'timeline' });
    expect(targets.map((target) => target.identity.handle)).toEqual(['outer', 'nested']);
    expect(targets.map((target) => target.badgeContainer)).toEqual([outer.name, nested.name]);

    nested.accountLink.setAttribute('href', '/Outer');
    const same = discoverXAccountPresentationTargets(outer.surface, { source: 'timeline' });
    expect(same).toHaveLength(2);
    expect(same[0].accountContainer).not.toBe(same[1].accountContainer);
  });

  it('does not let an outer tweet claim a nested UserCell', () => {
    const document = new FakeDocument();
    const outer = element(document, 'article', 'tweet');
    outer.appendChild(userCell(document, 'Nested').surface);
    expect(discoverXAccountPresentationTargets(outer, { source: 'timeline' })).toEqual([]);
  });

  it('chooses first equivalent links and containers but skips differing identities', () => {
    const document = new FakeDocument();
    const root = element(document, 'article', 'tweet');
    const first = element(document, 'div', 'User-Name');
    const firstProfile = link(document, '/OpenAI');
    first.appendChild(firstProfile);
    first.appendChild(link(document, '/OpenAI/status/1'));
    const second = element(document, 'div', 'UserName');
    second.appendChild(link(document, 'https://x.com/openai/media'));
    root.appendChild(first);
    root.appendChild(second);
    const [target] = discoverXAccountPresentationTargets(root, { source: 'timeline' });
    expect(target.badgeContainer).toBe(first);
    expect(target.link).toBe(firstProfile);
    second.appendChild(link(document, '/Different'));
    expect(discoverXAccountPresentationTargets(root, { source: 'timeline' })).toEqual([]);
  });

  it('keeps valid surfaces when another is ambiguous and deduplicates synthetic surfaces', () => {
    const document = new FakeDocument();
    const valid = tweet(document, 'Valid');
    const ambiguous = tweet(document, 'One');
    ambiguous.name.appendChild(link(document, '/Two'));
    const root = {
      querySelectorAll: vi.fn(() => [ambiguous.surface, valid.surface, valid.surface]),
    };
    const targets = discoverXAccountPresentationTargets(root, { source: 'timeline' });
    expect(targets).toHaveLength(1);
    expect(targets[0].identity.handle).toBe('valid');
    expect(root.querySelectorAll).toHaveBeenCalledOnce();
    expect(root.querySelectorAll).toHaveBeenCalledWith('article[data-testid="tweet"]');
  });

  it.each([
    ['profile', () => { const d = new FakeDocument(); const s = element(d, 'div', 'UserName'); s.appendChild(link(d, '/OpenAI')); return { d, s }; }],
    ['timeline', () => { const d = new FakeDocument(); return { d, s: tweet(d).surface }; }],
    ['reply', () => { const d = new FakeDocument(); return { d, s: tweet(d).surface }; }],
    ['search', () => { const d = new FakeDocument(); return { d, s: userCell(d).surface }; }],
    ['notification', () => { const d = new FakeDocument(); return { d, s: userCell(d).surface }; }],
  ])('interoperates with presentation without discovery rendering for %s', (source, build) => {
    const { s } = build();
    const before = snapshot(s);
    const [target] = discoverXAccountPresentationTargets(s, { source });
    expect(snapshot(s)).toEqual(before);
    const result = presentXAccountLink(target.link, target.badgeContainer, {
      source: target.source,
      location: { status: 'known', countryCode: 'CA', countryName: 'Canada' },
    }, normalizeSettings({}));
    expect(result.subject.identity).toEqual(target.identity);
    expect(findLocationBadge(target.badgeContainer)).not.toBeNull();
  });
});
