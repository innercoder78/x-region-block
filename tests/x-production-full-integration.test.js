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
    return Promise.resolve({
      ok: true, status: 200,
      json: () => ({ data: { user_result_by_screen_name: { result: {
        about_profile: { account_based_in: 'Japan' },
      } } } }),
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
      pushState(state, title, url) { globalScope.location.href = new URL(url, globalScope.location.href).href; },
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
  expect(decodeURIComponent(transportCalls[0].url)).toContain('"screen_name":"openai"');
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

  globalScope.history.pushState({}, '', '/openai/with_replies');
  globalScope.history.replaceState({}, '', '/openai/status/1');
  globalScope.location.href = 'https://x.com/home';
  globalScope.dispatchEvent(new MetadataEvent('popstate'));
  expect(observerInstances.some((observer) => observer.target === document)).toBe(true);

  runtime.stop();
  expect(runtime.isActive()).toBe(false);
  expect(runtime.isReady()).toBe(false);
  expect(globalScope.fetch).toBe(originalFetch);
  expect(globalScope.history.pushState).toBe(originalPush);
  expect(storageListeners.size).toBe(0);
  expect(observerInstances.every((observer) => observer.disconnected)).toBe(true);
  expect(transportCalls).toHaveLength(2);
  expect(transportCalls.every(({ url }) => url.startsWith('https://x.com/'))).toBe(true);
});
