import { expect, it, vi } from 'vitest';
import { createXProductionContentRuntime } from '../src/content/x-production-runtime.js';
import { installXPageRuntime } from '../src/page/x-page-runtime.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { FakeDocument, FakeElement } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { MetadataEvent, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 210));
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
  const link = document.createElement('a');
  link.setAttribute('href', '/OpenAI');
  name.appendChild(link); tweet.appendChild(name); document.appendChild(tweet);
  return { profile, tweet, name };
}

it('runs the real production page, metadata, transport, broker, route, and presentation path', async () => {
  const document = new FakeDocument();
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
  class AbortController {
    constructor() {
      const controller = createFakeAbortController();
      this.signal = controller.signal; this.abort = controller.abort.bind(controller);
      this.controller = controller;
    }
  }

  const transportCalls = [];
  let observingPageRequest = true;
  const originalFetch = vi.fn((url, options) => {
    if (observingPageRequest) return 'page-result';
    transportCalls.push({ url, options });
    const handle = JSON.parse(new URL(url).searchParams.get('variables')).screenName;
    let payload = { data: { user_result_by_screen_name: { result: {
      about_profile: { account_based_in: 'Japan' },
    } } } };
    if (handle === 'missing') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: {} } } } };
    } else if (handle === 'unavailable') {
      payload = { data: { user_result_by_screen_name: { result: { about_profile: null } } } };
    } else if (handle === 'malformed') payload = {};
    return Promise.resolve({
      ok: true, status: 200,
      json: () => payload,
    });
  });
  const storageListeners = new Set();
  const storedSettings = {
    schemaVersion: 1,
    country: { hide: ['JP'], highlight: [], alwaysShow: [] },
    region: { hide: [], highlight: [] }, language: { highlight: [] },
    tag: { highlight: [] }, other: { hide: [], highlight: [] }, allowlist: [],
  };
  const globalListeners = new Map();
  const globalScope = {
    location: { origin: 'https://x.com', hostname: 'x.com', href: 'https://x.com/openai' },
    document, Event: MetadataEvent, CustomEvent: MetadataEvent,
    URL, URLSearchParams, Headers, Request, Promise, MutationObserver, AbortController,
    fetch: originalFetch,
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
      runtime: { getURL: (path) => `moz-extension://test/${path}` },
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
  expect(globalScope.fetch).not.toBe(originalFetch);
  expect(globalScope.history.pushState).not.toBe(originalPush);

  expect(globalScope.fetch(observedUrl('learned_runtime_query', 'Observed'), {
    headers: observedHeaders,
  })).toBe('page-result');
  observingPageRequest = false;
  await settle();
  expect(runtime.isReady()).toBe(true);
  expect(transportCalls).toHaveLength(1);
  expect(decodeURIComponent(transportCalls[0].url)).toContain('"screenName":"openai"');
  expect(transportCalls[0].url).not.toContain('Observed');
  expect(transportCalls[0].options).toMatchObject({
    credentials: 'include', cache: 'no-store', redirect: 'error', method: 'GET',
  });
  expect(transportCalls[0].options.signal).toBeDefined();
  await settle();
  expect(findLocationBadge(targets.profile)).not.toBeNull();
  expect(findLocationBadge(targets.name)).not.toBeNull();
  expect(getAccountAction(targets.profile)).toBe('hide');
  expect(getAccountAction(targets.tweet)).toBe('hide');

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
  dynamicName.appendChild(dynamicLink); dynamicTweet.appendChild(dynamicName);
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
    ['missing', 'Location not provided'],
    ['unavailable', 'Location unavailable'],
    ['malformed', 'Location unavailable'],
  ]) {
    const outcomeTweet = document.createElement('article');
    outcomeTweet.setAttribute('data-testid', 'tweet');
    const outcomeName = document.createElement('div');
    outcomeName.setAttribute('data-testid', 'User-Name');
    const outcomeLink = document.createElement('a'); outcomeLink.setAttribute('href', `/${handle}`);
    outcomeName.appendChild(outcomeLink); outcomeTweet.appendChild(outcomeName);
    document.appendChild(outcomeTweet);
    for (const observer of routeObservers) observer.trigger();
    await settle();
    expect(findLocationBadge(outcomeName).textContent).toContain(label);
    expect(getAccountAction(outcomeTweet)).toBe('show');
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

async function recoveryHarness({ failureStatus, settings }) {
  const document = new FakeDocument();
  const listeners = new Map();
  document.addEventListener = (type, listener) => { const values = listeners.get(type) ?? []; values.push(listener); listeners.set(type, values); };
  document.removeEventListener = (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((value) => value !== listener));
  document.dispatchEvent = (event) => { for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event); return true; };
  const tweet = document.createElement('article'); tweet.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div'); name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a'); link.setAttribute('href', '/visible');
  name.appendChild(link); tweet.appendChild(name); document.appendChild(tweet);
  const observers = [];
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  class AbortController { constructor() { const value = createFakeAbortController(); this.signal = value.signal; this.abort = value.abort.bind(value); } }
  let pageTraffic = true; let attempt = 0; const transportCalls = [];
  const originalFetch = vi.fn((url, options) => {
    if (pageTraffic) return 'page-result';
    transportCalls.push({ url, options }); attempt += 1;
    if (attempt === 1) return Promise.resolve({ ok: false, status: failureStatus, json: () => null });
    return Promise.resolve({ ok: true, status: 200, json: () => ({ data: {
      user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Canada' } } },
    } }) });
  });
  const globalListeners = new Map(); const storageListeners = new Set();
  const globalScope = {
    location: { origin: 'https://x.com', hostname: 'x.com', href: 'https://x.com/home' },
    document, Event: MetadataEvent, CustomEvent: MetadataEvent, URL, URLSearchParams, Headers, Request,
    Promise, MutationObserver, AbortController, fetch: originalFetch,
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
  return { runtime, globalScope, tweet, name, link, transportCalls, capture, observers };
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
  expect(findLocationBadge(context.name).textContent).toContain('North America');
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
  context.capture('/i/api/graphql/generic/HomeTimeline?x=2', {
    ...observedHeaders, authorization: 'Bearer auth-only-change',
  });
  context.capture(observedUrl('XRqGa7EeokUU5kppkh13EA'), observedHeaders);
  await settle(); expect(context.transportCalls).toHaveLength(1);
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
