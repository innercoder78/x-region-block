import { expect, it, vi } from 'vitest';
import { createXProductionContentRuntime } from '../src/content/x-production-runtime.js';
import { installXPageRuntime } from '../src/page/x-page-runtime.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { FakeDocument, FakeElement } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { MetadataEvent, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

vi.useFakeTimers();

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(210);
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

function accountTargets(document) {
  const profile = document.createElement('div');
  profile.setAttribute('data-testid', 'UserName');
  const profileLink = document.createElement('a');
  profileLink.setAttribute('href', '/openai');
  profile.appendChild(profileLink);
  document.appendChild(profile);

  const tweet = document.createElement('article');
  tweet.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const shell = document.createElement('div'); const column = document.createElement('div');
  const pinned = document.createElement('div'); pinned.textContent = 'Pinned';
  const authorRow = document.createElement('div'); const menu = document.createElement('button');
  menu.setAttribute('data-testid', 'caret'); menu.textContent = 'Menu';
  const link = document.createElement('a');
  link.setAttribute('href', '/OpenAI');
  name.appendChild(link); authorRow.appendChild(name); authorRow.appendChild(menu);
  column.appendChild(pinned); column.appendChild(authorRow); shell.appendChild(column);
  tweet.appendChild(shell); document.appendChild(tweet);
  const nested = document.createElement('article'); nested.setAttribute('data-testid', 'tweet');
  const nestedShell = document.createElement('div'); const nestedColumn = document.createElement('div');
  const nestedRow = document.createElement('div'); const nestedName = document.createElement('div');
  nestedName.setAttribute('data-testid', 'User-Name'); const nestedLink = document.createElement('a');
  const nestedMenu = document.createElement('button'); nestedMenu.setAttribute('data-testid', 'caret');
  nestedLink.setAttribute('href', '/OpenAI'); nestedName.appendChild(nestedLink); nestedRow.appendChild(nestedName);
  nestedRow.appendChild(nestedMenu);
  nestedColumn.appendChild(nestedRow); nestedShell.appendChild(nestedColumn); nested.appendChild(nestedShell);
  column.appendChild(nested);
  return { profile, tweet, name, pinned, authorRow, column, nested, nestedName };
}

it('runs the real production page, metadata, transport, broker, route, and presentation path', async () => {
  const document = new FakeDocument();
  const navigation = document.createElement('nav'); const more = document.createElement('a');
  more.setAttribute('data-testid', 'AppTabBar_More_Menu'); navigation.appendChild(more); document.appendChild(navigation);
  const listeners = new Map();
  document.addEventListener = (type, listener) => {
    const values = listeners.get(`document:${type}`) ?? [];
    values.push(listener); listeners.set(`document:${type}`, values);
  };
  document.removeEventListener = (type, listener) => {
    const key = `document:${type}`;
    listeners.set(key, (listeners.get(key) ?? []).filter((value) => value !== listener));
  };
  document.dispatchEvent = (event) => {
    for (const listener of [...(listeners.get(`document:${event.type}`) ?? [])]) listener(event);
    return true;
  };
  const targets = accountTargets(document);

  const observerInstances = [];
  class MutationObserver {
    constructor(callback) {
      this.callback = callback; this.disconnected = false; observerInstances.push(this);
    }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    trigger(records = [{}]) { this.callback(records); }
  }
  const AbortController = globalThis.AbortController;
  const nativeController = new AbortController();
  expect(Object.hasOwn(nativeController, 'signal')).toBe(false);
  expect(Object.hasOwn(nativeController, 'abort')).toBe(false);

  const transportCalls = [];
  let observingPageRequest = true;
  const originalFetch = vi.fn((url, options) => {
    if (observingPageRequest) return 'page-result';
    transportCalls.push({ url, options });
    const handle = JSON.parse(new URL(url).searchParams.get('variables')).screenName;
    const english = options.headers['accept-language'] === 'en-US,en;q=0.9';
    let payload = { data: { user_result_by_screen_name: { result: {
      about_profile: { account_based_in: english ? 'United States' : 'États-Unis',
        source: 'United States App Store', location_accurate: false,
        connected_via: 'Google Play', app_store: 'North America App Store', token: 'must-not-cross' },
    } } } };
    if (handle === 'missing') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: {} } } } };
    } else if (handle === 'unavailable') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: null } } } };
    } else if (handle === 'region') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: {
        account_based_in: 'North America', source: 'Google Play', location_accurate: true,
        connected_via: 'United States App Store',
      } } } } };
    } else if (handle === 'web') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: {
        account_based_in: 'United States', source: 'Web', location_accurate: true,
      } } } } };
    } else if (handle === 'noaccuracy') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: {
        account_based_in: 'United States', source: 'App Store', connected_via: 'Google Play',
      } } } } };
    } else if (handle === 'malformed') payload = {};
    return Promise.resolve({
      ok: true, status: 200,
      json: () => payload,
    });
  });
  const storageListeners = new Set();
  const storedSettings = {
    schemaVersion: 1,
    country: { hide: ['US'], highlight: [], alwaysShow: [] },
    region: { hide: [], highlight: [] }, language: { highlight: [] },
    tag: { highlight: [] }, other: { hide: [], highlight: [] }, allowlist: [],
  };
  const globalListeners = new Map();
  const console = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const globalScope = {
    location: { origin: 'https://x.com', hostname: 'x.com', href: 'https://x.com/openai' },
    document, Event: MetadataEvent, CustomEvent: MetadataEvent,
    URL, URLSearchParams, Headers, Request, Promise, MutationObserver, AbortController,
    fetch: originalFetch, console,
    history: {
      pushState(state, title, url) {
        if (url === '/failed') throw new Error('simulated history failure');
        globalScope.location.href = new URL(url, globalScope.location.href).href;
      },
      replaceState(state, title, url) { globalScope.location.href = new URL(url, globalScope.location.href).href; },
    },
    addEventListener(type, listener) {
      const values = globalListeners.get(type) ?? []; values.push(listener); globalListeners.set(type, values);
    },
    removeEventListener(type, listener) {
      globalListeners.set(type, (globalListeners.get(type) ?? []).filter((value) => value !== listener));
    },
    dispatchEvent(event) {
      for (const listener of [...(globalListeners.get(event.type) ?? [])]) listener(event);
    },
    browser: {
      runtime: { getURL: (path) => `moz-extension://test/${path}`, sendMessage: vi.fn(async () => ({ ok: true })) },
      storage: {
        local: {
          get: async () => ({ 'xRegionBlock.settings': storedSettings }),
          set: async () => {}, remove: async () => {},
        },
        onChanged: {
          addListener: (listener) => storageListeners.add(listener),
          removeListener: (listener) => storageListeners.delete(listener),
        },
      },
    },
  };
  const scriptRoot = new FakeElement('html', document);
  document.documentElement = scriptRoot;
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => createElement(tagName);
  const appendScript = scriptRoot.appendChild.bind(scriptRoot);
  scriptRoot.appendChild = (script) => {
    appendScript(script);
    installXPageRuntime(globalScope);
    script.onload?.();
    return script;
  };

  const originalPush = globalScope.history.pushState;
  const runtime = createXProductionContentRuntime(globalScope);
  await runtime.start();
  expect(runtime.isActive()).toBe(true);
  expect(runtime.isReady()).toBe(false);
  const sidebar = document.querySelectorAll('[data-x-region-block-sidebar-item="1"]')[0];
  expect(navigation.children).toEqual([sidebar, more]);
  sidebar.dispatchEvent({ type: 'click' }); expect(globalScope.browser.runtime.sendMessage).toHaveBeenCalledOnce();
  expect(globalScope.fetch).not.toBe(originalFetch);
  expect(globalScope.history.pushState).not.toBe(originalPush);

  expect(globalScope.fetch(observedUrl('learned_runtime_query', 'Observed'), {
    headers: { ...observedHeaders, 'x-twitter-client-language': 'fr',
      'x-client-transaction-id': 'stale-production-transaction' },
  })).toBe('page-result');
  observingPageRequest = false;
  await settle();
  expect(runtime.isReady()).toBe(true);
  expect(transportCalls).toHaveLength(1);
  expect(decodeURIComponent(transportCalls[0].url)).toContain('"screenName":"openai"');
  expect(transportCalls[0].url).not.toContain('Observed');
  expect(transportCalls[0].options).toMatchObject({ credentials: 'include', method: 'GET' });
  expect(transportCalls[0].options).not.toHaveProperty('cache');
  expect(transportCalls[0].options).not.toHaveProperty('redirect');
  expect(transportCalls[0].options.signal).toBeDefined();
  expect(transportCalls[0].options.headers['accept-language']).toBe('en-US,en;q=0.9');
  expect(transportCalls[0].options.headers['x-twitter-client-language']).toBe('fr');
  expect(transportCalls[0].options.headers).not.toHaveProperty('x-client-transaction-id');
  await settle();
  expect(findLocationBadge(targets.profile)).not.toBeNull();
  expect(findLocationBadge(targets.name)).not.toBeNull();
  expect(findLocationBadge(targets.nestedName)).not.toBeNull();
  const outerHeader = targets.column.children[1];
  expect(targets.column.children.slice(0, 3)).toEqual([targets.pinned, outerHeader, targets.authorRow]);
  expect(targets.authorRow.children).not.toContain(outerHeader);
  expect(findLocationBadge(targets.name).children[0].children[0].getAttribute('src'))
    .toContain('assets/flags/us.png');
  expect(findLocationBadge(targets.name).textContent).not.toContain('🌐');
  expect(findLocationBadge(targets.name).textContent).not.toContain('North America');
  expect(findLocationBadge(targets.name).children).toHaveLength(3);
  expect(findLocationBadge(targets.name).textContent)
    .toBe('Country: | VPN/proxy detected | Connection: iOS app');
  expect(findLocationBadge(targets.name).getAttribute('aria-label'))
    .toBe('Country: United States. VPN or proxy detected. Connection: iOS app.');
  expect(findLocationBadge(targets.name).textContent).not.toMatch(/Google Play|North America App Store|token/);
  expect(findLocationBadge(targets.name).textContent).not.toContain('Location unavailable');
  expect(console.warn.mock.calls.flat().join('\n'))
    .not.toContain('About Account request queue failed.');
  expect(getAccountAction(targets.profile)).toBe('hide');
  expect(getAccountAction(targets.tweet)).toBe('hide');
  const callsBeforeAnchorReplacement = transportCalls.length;
  const replacementColumn = document.createElement('div'); const replacementRow = document.createElement('div');
  targets.authorRow.removeChild(targets.name); replacementRow.appendChild(targets.name);
  const replacementMenu = document.createElement('button'); replacementMenu.setAttribute('data-testid', 'caret');
  replacementRow.appendChild(replacementMenu);
  replacementColumn.appendChild(replacementRow); targets.tweet.children[0].removeChild(targets.column);
  targets.tweet.children[0].appendChild(replacementColumn); observerInstances.forEach((observer) => observer.trigger());
  await settle(); expect(transportCalls).toHaveLength(callsBeforeAnchorReplacement);
  expect(replacementColumn.children[0].getAttribute('data-x-region-block-location-header')).toBe('1');

  const latestHeaders = { ...observedHeaders, authorization: 'Bearer latest-test-only' };
  observingPageRequest = true;
  expect(globalScope.fetch(observedUrl('latest_runtime_query', 'LatestObserved'), {
    headers: latestHeaders,
  })).toBe('page-result');
  observingPageRequest = false;
  const dynamicTweet = document.createElement('article');
  dynamicTweet.setAttribute('data-testid', 'tweet');
  const dynamicName = document.createElement('div');
  dynamicName.setAttribute('data-testid', 'User-Name');
  const dynamicLink = document.createElement('a');
  dynamicLink.setAttribute('href', '/anthropic');
  const dynamicShell = document.createElement('div'); const dynamicColumn = document.createElement('div');
  const dynamicRow = document.createElement('div'); dynamicName.appendChild(dynamicLink);
  const dynamicMenu = document.createElement('button'); dynamicMenu.setAttribute('data-testid', 'caret');
  dynamicRow.appendChild(dynamicName); dynamicRow.appendChild(dynamicMenu); dynamicColumn.appendChild(dynamicRow);
  dynamicShell.appendChild(dynamicColumn); dynamicTweet.appendChild(dynamicShell);
  document.appendChild(dynamicTweet);
  const routeObservers = observerInstances.filter((observer) => observer.target === document);
  for (const observer of routeObservers) observer.trigger();
  await settle();
  expect(transportCalls).toHaveLength(2);
  expect(transportCalls[1].url).toContain('/latest_runtime_query/');
  expect(decodeURIComponent(transportCalls[1].url)).toContain('"screenName":"anthropic"');
  expect(transportCalls[1].url).not.toContain('LatestObserved');
  expect(transportCalls[1].options.headers.authorization).toBe('Bearer latest-test-only');
  expect(findLocationBadge(dynamicName)).not.toBeNull();
  for (const observer of routeObservers) observer.trigger();
  await settle();
  expect(transportCalls).toHaveLength(2);
  dynamicLink.setAttribute('href', '/google');
  for (const observer of routeObservers) observer.trigger();
  await settle();
  expect(transportCalls).toHaveLength(3);
  expect(decodeURIComponent(transportCalls[2].url)).toContain('"screenName":"google"');
  document.children.splice(document.children.indexOf(dynamicTweet), 1);
  dynamicTweet.parentNode = null;
  for (const observer of routeObservers) observer.trigger();
  await settle();
  expect(findLocationBadge(dynamicName)).toBeNull();
  expect(getAccountAction(dynamicTweet)).toBe('show');

  for (const [handle, label] of [
    ['missing', 'Location: Not provided'],
    ['unavailable', 'Location: Unavailable'],
    ['malformed', 'Location: Unavailable'], ['region', 'North America'],
    ['web', 'Connection: Web'], ['noaccuracy', 'Connection: iOS app'],
  ]) {
    const outcomeTweet = document.createElement('article');
    outcomeTweet.setAttribute('data-testid', 'tweet');
    const outcomeName = document.createElement('div');
    outcomeName.setAttribute('data-testid', 'User-Name');
    const outcomeLink = document.createElement('a'); outcomeLink.setAttribute('href', `/${handle}`);
    const outcomeShell = document.createElement('div'); const outcomeColumn = document.createElement('div');
    const outcomeRow = document.createElement('div'); outcomeName.appendChild(outcomeLink);
    const outcomeMenu = document.createElement('button'); outcomeMenu.setAttribute('data-testid', 'caret');
    outcomeRow.appendChild(outcomeName); outcomeRow.appendChild(outcomeMenu); outcomeColumn.appendChild(outcomeRow);
    outcomeShell.appendChild(outcomeColumn); outcomeTweet.appendChild(outcomeShell);
    document.appendChild(outcomeTweet);
    for (const observer of routeObservers) observer.trigger();
    await settle();
    expect(findLocationBadge(outcomeName).textContent).toContain(label);
    if (handle === 'region') {
      expect(findLocationBadge(outcomeName).textContent)
        .toBe('Region: 🌐 North America | Connection: Android app');
      expect(findLocationBadge(outcomeName).textContent).not.toContain('Location unknown');
    }
    if (handle === 'missing') expect(findLocationBadge(outcomeName).textContent)
      .toBe('Location: Not provided | Unknown connection method');
    if (handle === 'web') expect(findLocationBadge(outcomeName).textContent)
      .toBe('Country: | Connection: Web');
    if (handle === 'noaccuracy') {
      expect(findLocationBadge(outcomeName).textContent).toBe('Country: | Connection: iOS app');
      expect(findLocationBadge(outcomeName).textContent).not.toContain('VPN/proxy detected');
    }
    expect(getAccountAction(outcomeTweet)).toBe(['web', 'noaccuracy'].includes(handle) ? 'hide' : 'show');
    document.children.splice(document.children.indexOf(outcomeTweet), 1);
    outcomeTweet.parentNode = null;
    for (const observer of routeObservers) observer.trigger();
    await settle();
  }

  const beforeNavigation = transportCalls.length;
  expect(() => globalScope.history.pushState({}, '', '/failed')).toThrow('simulated history failure');
  expect(transportCalls).toHaveLength(beforeNavigation);
  globalScope.history.pushState({}, '', '/openai/with_replies');
  const afterPush = transportCalls.length;
  expect(afterPush).toBe(beforeNavigation + 1);
  await settle();
  globalScope.history.replaceState({}, '', '/openai/status/1');
  expect(transportCalls.length).toBe(afterPush);
  globalScope.location.href = 'https://x.com/home';
  globalScope.dispatchEvent(new MetadataEvent('popstate'));
  const afterHome = transportCalls.length;
  expect(afterHome).toBe(afterPush + 1);
  expect(decodeURIComponent(transportCalls.at(-1).url)).toContain('"screenName":"openai"');
  expect(observerInstances.some((observer) => observer.target === document)).toBe(true);

  runtime.stop();
  expect(runtime.isActive()).toBe(false);
  expect(runtime.isReady()).toBe(false);
  expect(globalScope.fetch).toBe(originalFetch);
  expect(globalScope.history.pushState).toBe(originalPush);
  expect(storageListeners.size).toBe(0);
  expect(observerInstances.every((observer) => observer.disconnected)).toBe(true);
  expect(transportCalls).toHaveLength(afterHome);
  expect(transportCalls.every(({ url }) => url.startsWith('https://x.com/'))).toBe(true);
});

async function recoveryHarness({ failureStatus, settings, responder = null }) {
  const document = new FakeDocument();
  const listeners = new Map();
  document.addEventListener = (type, listener) => { const values = listeners.get(type) ?? []; values.push(listener); listeners.set(type, values); };
  document.removeEventListener = (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((value) => value !== listener));
  document.dispatchEvent = (event) => { for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event); return true; };
  const tweet = document.createElement('article'); tweet.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div'); name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a'); link.setAttribute('href', '/visible');
  const shell = document.createElement('div'); const column = document.createElement('div');
  const authorRow = document.createElement('div'); const menu = document.createElement('button');
  menu.setAttribute('data-testid', 'caret'); name.appendChild(link); authorRow.appendChild(name); authorRow.appendChild(menu);
  column.appendChild(authorRow); shell.appendChild(column); tweet.appendChild(shell); document.appendChild(tweet);
  const observers = [];
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  class AbortController { constructor() { const value = createFakeAbortController(); this.signal = value.signal; this.abort = value.abort.bind(value); } }
  let pageTraffic = true; let attempt = 0; const transportCalls = [];
  const originalFetch = vi.fn((url, options) => {
    if (pageTraffic) return 'page-result';
    transportCalls.push({ url, options }); attempt += 1;
    if (responder) return responder(attempt);
    if (attempt === 1) return Promise.resolve({ ok: false, status: failureStatus, json: () => null });
    return Promise.resolve({ ok: true, status: 200, json: () => ({ data: {
      user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Canada' } } },
    } }) });
  });
  const globalListeners = new Map(); const storageListeners = new Set();
  const console = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const globalScope = {
    location: { origin: 'https://x.com', hostname: 'x.com', href: 'https://x.com/home' },
    document, Event: MetadataEvent, CustomEvent: MetadataEvent, URL, URLSearchParams, Headers, Request,
    Promise, MutationObserver, AbortController, fetch: originalFetch, console,
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, listener) { const values = globalListeners.get(type) ?? []; values.push(listener); globalListeners.set(type, values); },
    removeEventListener(type, listener) { globalListeners.set(type, (globalListeners.get(type) ?? []).filter((item) => item !== listener)); },
    browser: { runtime: { getURL: (path) => `moz-extension://test/${path}` }, storage: {
      local: { get: async () => ({ 'xRegionBlock.settings': settings }), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: (listener) => storageListeners.add(listener), removeListener: (listener) => storageListeners.delete(listener) },
    } },
  };
  const scriptRoot = new FakeElement('html', document); document.documentElement = scriptRoot;
  scriptRoot.appendChild = (script) => { installXPageRuntime(globalScope); script.onload?.(); return script; };
  const runtime = createXProductionContentRuntime(globalScope); await runtime.start();
  const capture = (url, headers) => { pageTraffic = true; const result = globalScope.fetch(url, { headers }); pageTraffic = false; return result; };
  return { runtime, globalScope, tweet, name, link, transportCalls, capture, observers, console };
}

it('recovers the same visible production target after genuinely fresh authentication metadata', async () => {
  const settings = { schemaVersion: 1, country: { hide: [], highlight: [], alwaysShow: [] },
    region: { hide: [], highlight: ['NORTH_AMERICA'] }, language: { highlight: [] },
    tag: { highlight: [] }, other: { hide: [], highlight: [] }, allowlist: [] };
  const context = await recoveryHarness({ failureStatus: 401, settings });
  context.capture('/i/api/graphql/generic/HomeTimeline?x=1', observedHeaders); await settle();
  expect(context.transportCalls).toHaveLength(1);
  expect(findLocationBadge(context.name)).toBeNull();
  for (const headers of [
    { ...observedHeaders, 'x-client-transaction-id': 'volatile' },
    { ...observedHeaders, 'x-twitter-client-language': 'fr' },
    { ...observedHeaders, 'x-twitter-active-user': 'no' },
  ]) context.capture('/i/api/graphql/generic/HomeTimeline?volatile=1', headers);
  await settle(); expect(context.transportCalls).toHaveLength(1);
  context.capture('/i/api/graphql/generic/HomeTimeline?fresh=1', {
    ...observedHeaders, 'x-csrf-token': 'fresh-csrf',
  });
  await settle();
  expect(context.transportCalls).toHaveLength(2);
  expect(findLocationBadge(context.name).children[0].children[0].getAttribute('src'))
    .toContain('assets/flags/ca.png');
  expect(findLocationBadge(context.name).textContent).not.toContain('North America');
  expect(getAccountAction(context.tweet)).toBe('highlight');
  context.capture('/i/api/graphql/generic/HomeTimeline?replay=1', {
    ...observedHeaders, 'x-csrf-token': 'fresh-csrf',
  });
  await settle(); expect(context.transportCalls).toHaveLength(2);
  context.runtime.stop();
});

it('recovers a visible production target only after a different live query ID', async () => {
  const settings = { schemaVersion: 1, country: { hide: ['CA'], highlight: [], alwaysShow: ['CA'] },
    region: { hide: [], highlight: [] }, language: { highlight: [] }, tag: { highlight: [] },
    other: { hide: [], highlight: [] }, allowlist: [] };
  const context = await recoveryHarness({ failureStatus: 404, settings });
  context.capture('/i/api/graphql/generic/HomeTimeline?x=1', observedHeaders); await settle();
  expect(context.transportCalls).toHaveLength(1);
  expect(findLocationBadge(context.name)).toBeNull();
  context.capture(observedUrl('replacement_live_query'), observedHeaders); await settle();
  expect(context.transportCalls).toHaveLength(2);
  expect(context.transportCalls[1].url).toContain('/replacement_live_query/AboutAccountQuery');
  expect(findLocationBadge(context.name).children[0].children[0].getAttribute('src'))
    .toContain('assets/flags/ca.png');
  expect(getAccountAction(context.tweet)).toBe('show');
  context.capture(observedUrl('XRqGa7EeokUU5kppkh13EA'), observedHeaders); await settle();
  expect(context.transportCalls).toHaveLength(2);
  context.runtime.stop();
});

it.each([
  ['NETWORK', 'network request failed'], ['BRIDGE_TIMEOUT', 'request bridge timed out'],
  ['UNKNOWN', 'About Account request failed unexpectedly'],
  ['INVALID_PAYLOAD', 'response payload was invalid'], ['HTTP_401', 'authentication metadata rejected'],
  ['HTTP_404', 'query ID rejected'], ['HTTP_429', 'rate limited'], ['HTTP_5XX', 'server request failed'],
])('preserves %s through the real production processing diagnostic path', async (code, expected) => {
  const settings = { schemaVersion: 1, country: { hide: [], highlight: [], alwaysShow: [] },
    region: { hide: [], highlight: [] }, language: { highlight: [] }, tag: { highlight: [] },
    other: { hide: [], highlight: [] }, allowlist: [] };
  const response = () => {
    if (code === 'BRIDGE_TIMEOUT') return new Promise(() => {});
    if (code === 'NETWORK') return Promise.reject(new Error('private-network-secret'));
    if (code === 'INVALID_PAYLOAD') return Promise.resolve({ ok: true, status: 200, json: () => undefined });
    if (code === 'UNKNOWN') return Promise.resolve({
      ok: false, status: 302, headers: new Headers(), json: () => null,
    });
    const status = { HTTP_401: 401, HTTP_404: 404, HTTP_429: 429, HTTP_5XX: 500 }[code];
    return Promise.resolve({ ok: false, status, headers: new Headers(), json: () => null });
  };
  const context = await recoveryHarness({ failureStatus: 500, settings, responder: response });
  context.capture('/i/api/graphql/generic/HomeTimeline?diagnostic=1', observedHeaders);
  await settle();
  if (code === 'NETWORK' || code === 'HTTP_5XX') await vi.advanceTimersByTimeAsync(3_500);
  else if (code === 'BRIDGE_TIMEOUT') await vi.advanceTimersByTimeAsync(30_500);
  else if (code === 'HTTP_429') await vi.advanceTimersByTimeAsync(60_500);
  else if (code === 'HTTP_401') {
    context.capture('/i/api/graphql/generic/HomeTimeline?fresh=1', {
      ...observedHeaders, 'x-csrf-token': 'fresh-csrf',
    });
    await vi.advanceTimersByTimeAsync(250);
  } else if (code === 'HTTP_404') {
    context.capture(observedUrl('fresh_diagnostic_query'), observedHeaders);
    await vi.advanceTimersByTimeAsync(250);
  }
  await Promise.resolve(); await Promise.resolve();
  const diagnostics = context.console.warn.mock.calls.flat().join('\n');
  expect(diagnostics).toContain(expected);
  expect(diagnostics).not.toContain('Account processing encountered a lifecycle error.');
  if (code === 'UNKNOWN') {
    expect(diagnostics).not.toContain('About Account request queue failed.');
    expect(diagnostics).not.toContain('Account processing failed.');
  }
  expect(diagnostics).not.toMatch(/private-network-secret|raw-secret-payload|diagnostic=1|@visible|authorization|csrf|cookie|token/i);
  context.runtime.stop();
});
