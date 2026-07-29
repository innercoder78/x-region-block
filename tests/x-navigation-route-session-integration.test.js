import { expect, it, vi } from 'vitest';
import { installXNavigationSignal } from '../src/page/x-navigation-signal.js';
import { createXNavigationObserver } from '../src/content/x-navigation-observer.js';
import { createXAccountTargetRouteSessionController } from '../src/content/account-target-route-session-controller.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

it('connects an explicitly installed page signal to explicit content observation', () => {
  const listeners = new Map();
  const document = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };
  const global = {
    location: { href: 'https://x.com/home' }, document,
    history: {
      pushState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
      replaceState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
    },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const onNavigate = vi.fn();
  const observer = createXNavigationObserver(global, { onNavigate, onError: vi.fn() });
  const signal = installXNavigationSignal(global);
  observer.start();
  global.history.pushState({}, '', '/alice/with_replies');
  expect(onNavigate).toHaveBeenCalledWith('https://x.com/alice/with_replies');
  observer.stop();
  signal.stop();
});

it('runs real navigation, routing, brokerage, sessions, parsing, and presentation', async () => {
  const listeners = new Map();
  const eventDocument = {
    addEventListener: (type, listener) => listeners.set(`document:${type}`, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(`document:${type}`) === listener) listeners.delete(`document:${type}`);
    },
    dispatchEvent: (event) => listeners.get(`document:${event.type}`)?.(event),
  };
  const global = {
    location: { href: 'https://x.com/openai' }, document: eventDocument,
    history: {
      pushState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
      replaceState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
    },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => listeners.set(`global:${type}`, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(`global:${type}`) === listener) listeners.delete(`global:${type}`);
    },
  };
  const root = new FakeDocument();
  const profile = root.createElement('div');
  profile.setAttribute('data-testid', 'UserName');
  const profileLink = root.createElement('a');
  profileLink.setAttribute('href', '/openai');
  profile.appendChild(profileLink);
  root.appendChild(profile);
  const tweet = root.createElement('article');
  tweet.setAttribute('data-testid', 'tweet');
  const tweetName = root.createElement('div');
  tweetName.setAttribute('data-testid', 'User-Name');
  const tweetLink = root.createElement('a');
  tweetLink.setAttribute('href', '/openai');
  tweetName.appendChild(tweetLink);
  const tweetShell = root.createElement('div'); const tweetColumn = root.createElement('div');
  const tweetRow = root.createElement('div'); const tweetMenu = root.createElement('button');
  tweetMenu.setAttribute('data-testid', 'caret'); tweetRow.appendChild(tweetName); tweetRow.appendChild(tweetMenu);
  tweetColumn.appendChild(tweetRow);
  tweetShell.appendChild(tweetColumn); tweet.appendChild(tweetShell);
  root.appendChild(tweet);
  const mutation = createFakeObserverFactory();
  const loadPayload = vi.fn(async () => ({
    data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
  }));
  const runtime = { getSettings: () => ({}), subscribe: () => () => {} };
  const controller = createXAccountTargetRouteSessionController(root, {
    settingsRuntime: runtime,
    observerFactory: mutation.factory,
    loadPayload,
    brokerAbortControllerFactory: createFakeAbortController,
    consumerAbortControllerFactory: createFakeAbortController,
    navigationObserverFactory: ({ onNavigate, onError }) => createXNavigationObserver(
      global, { onNavigate, onError },
    ),
    onError: vi.fn(),
  });
  const signal = installXNavigationSignal(global);
  expect(controller.start()).toHaveLength(2);
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['profile', 'timeline']);
  expect(loadPayload).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(findLocationBadge(profile)).not.toBeNull();
  expect(findLocationBadge(tweetName)).not.toBeNull();

  global.history.pushState({}, '', '/openai/with_replies');
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['profile', 'reply']);
  expect(loadPayload).toHaveBeenCalledTimes(2);
  global.history.pushState({}, '', '/openai/status/1');
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['reply']);
  expect(controller.getTargets()).toHaveLength(1);
  expect(loadPayload).toHaveBeenCalledTimes(2);
  global.history.replaceState({}, '', '/i/bookmarks');
  expect(controller.getRoute().type).toBe('unsupported');
  expect(controller.getTargets()).toEqual([]);
  expect(findLocationBadge(profile)).toBeNull();
  expect(findLocationBadge(tweetName)).toBeNull();
  expect(getAccountAction(profile)).toBe('show');
  expect(getAccountAction(tweet)).toBe('show');

  global.location.href = 'https://x.com/home';
  listeners.get('global:popstate')();
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
  expect(loadPayload).toHaveBeenCalledTimes(3);
  const stalePopstate = listeners.get('global:popstate');
  controller.stop();
  signal.stop();
  global.history.pushState({}, '', '/openai');
  stalePopstate();
  expect(controller.getRoute()).toBeNull();
});

it('transfers one real pending broker request before retiring the old route consumer', async () => {
  const listeners = new Map();
  const eventDocument = {
    addEventListener: (type, listener) => listeners.set(`document:${type}`, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(`document:${type}`) === listener) listeners.delete(`document:${type}`);
    },
    dispatchEvent: (event) => listeners.get(`document:${event.type}`)?.(event),
  };
  const global = {
    location: { href: 'https://x.com/openai/status/1' }, document: eventDocument,
    history: {
      pushState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
      replaceState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
    },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => listeners.set(`global:${type}`, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(`global:${type}`) === listener) listeners.delete(`global:${type}`);
    },
  };
  const root = new FakeDocument();
  const tweet = root.createElement('article');
  tweet.setAttribute('data-testid', 'tweet');
  const name = root.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const link = root.createElement('a');
  link.setAttribute('href', '/openai');
  name.appendChild(link);
  const shell = root.createElement('div'); const column = root.createElement('div');
  const row = root.createElement('div'); const menu = root.createElement('button');
  menu.setAttribute('data-testid', 'caret'); row.appendChild(name); row.appendChild(menu); column.appendChild(row);
  shell.appendChild(column); tweet.appendChild(shell);
  root.appendChild(tweet);
  const lookup = deferred();
  const sharedControllers = [];
  const consumerControllers = [];
  const loadPayload = vi.fn(() => lookup.promise);
  const controller = createXAccountTargetRouteSessionController(root, {
    settingsRuntime: { getSettings: () => ({}), subscribe: () => () => {} },
    observerFactory: createFakeObserverFactory().factory,
    loadPayload,
    brokerAbortControllerFactory: () => {
      const value = createFakeAbortController();
      sharedControllers.push(value);
      return value;
    },
    consumerAbortControllerFactory: () => {
      const value = createFakeAbortController();
      consumerControllers.push(value);
      return value;
    },
    navigationObserverFactory: ({ onNavigate, onError }) => createXNavigationObserver(
      global, { onNavigate, onError },
    ),
    onError: vi.fn(),
  });
  const signal = installXNavigationSignal(global);
  controller.start();
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['reply']);
  expect(loadPayload).toHaveBeenCalledTimes(1);
  expect(consumerControllers).toHaveLength(1);
  global.history.pushState({}, '', '/home');
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
  expect(loadPayload).toHaveBeenCalledTimes(1);
  expect(consumerControllers).toHaveLength(2);
  expect(consumerControllers[0].signal).not.toBe(consumerControllers[1].signal);
  expect(sharedControllers[0].abortCount).toBe(0);
  lookup.resolve({
    data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(findLocationBadge(name)).not.toBeNull();
  controller.stop();
  signal.stop();
  expect(findLocationBadge(name)).toBeNull();
});

it('buffers real synchronous registration navigation until observer startup commits', async () => {
  const listeners = new Map();
  let runtimeReads = 0;
  let deliverDuringRegistration = true;
  const global = {
    location: { href: 'https://x.com/i/bookmarks' },
    document: {
      addEventListener(type, listener) {
        listeners.set(`document:${type}`, listener);
        if (deliverDuringRegistration) {
          const initial = global.location.href;
          global.location.href = 'https://x.com/search?q=discarded';
          listener();
          global.location.href = 'https://x.com/home';
          listener();
          global.location.href = initial;
          expect(runtimeReads).toBe(0);
        }
      },
      removeEventListener(type, listener) {
        if (listeners.get(`document:${type}`) === listener) listeners.delete(`document:${type}`);
      },
      dispatchEvent: (event) => listeners.get(`document:${event.type}`)?.(event),
    },
    history: {
      pushState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
      replaceState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
    },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => listeners.set(`global:${type}`, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(`global:${type}`) === listener) listeners.delete(`global:${type}`);
    },
  };
  const root = new FakeDocument();
  const tweet = root.createElement('article');
  tweet.setAttribute('data-testid', 'tweet');
  const name = root.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const link = root.createElement('a');
  link.setAttribute('href', '/openai');
  name.appendChild(link);
  const shell = root.createElement('div'); const column = root.createElement('div');
  const row = root.createElement('div'); const menu = root.createElement('button');
  menu.setAttribute('data-testid', 'caret'); row.appendChild(name); row.appendChild(menu); column.appendChild(row);
  shell.appendChild(column); tweet.appendChild(shell);
  root.appendChild(tweet);
  const loadPayload = vi.fn(async () => ({
    data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
  }));
  const controller = createXAccountTargetRouteSessionController(root, {
    settingsRuntime: {
      getSettings() { runtimeReads += 1; return {}; },
      subscribe: () => () => {},
    },
    observerFactory: createFakeObserverFactory().factory,
    loadPayload,
    brokerAbortControllerFactory: createFakeAbortController,
    consumerAbortControllerFactory: createFakeAbortController,
    navigationObserverFactory: ({ onNavigate, onError }) => createXNavigationObserver(
      global, { onNavigate, onError },
    ),
    onError: vi.fn(),
  });
  const signal = installXNavigationSignal(global);
  controller.start();
  deliverDuringRegistration = false;
  expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
  expect(runtimeReads).toBe(1);
  expect(loadPayload).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(findLocationBadge(name)).not.toBeNull();
  controller.stop();
  signal.stop();
  expect(listeners.size).toBe(0);
  expect(findLocationBadge(name)).toBeNull();
});
