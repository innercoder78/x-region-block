import { expect, it, vi } from 'vitest';
import { createXAccountTargetSession } from '../src/content/account-target-session.js';
import { createXAboutAccountPayloadBroker } from '../src/content/x-about-account-payload-broker.js';
import { createXAboutAccountRequestTransport } from '../src/content/x-about-account-request-transport.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

const payload = {
  data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
};
const settle = () => Promise.resolve().then(() => Promise.resolve());
function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
function runtime(settings) {
  return { getSettings: () => settings, subscribe: () => () => {} };
}
function profileRoot(handle) {
  const document = new FakeDocument();
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'UserName');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  root.appendChild(link);
  document.appendChild(root);
  return { root, link };
}
function timelineRoot(handle) {
  const document = new FakeDocument();
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link);
  const shell = document.createElement('div'); const column = document.createElement('div');
  const row = document.createElement('div'); row.appendChild(name); column.appendChild(row);
  shell.appendChild(column); article.appendChild(shell);
  document.appendChild(article);
  return { root: document, article, name };
}
function session(root, source, broker, settings, consumerControllers, onError = vi.fn()) {
  return createXAccountTargetSession(root, {
    source,
    settingsRuntime: runtime(settings),
    observerFactory: createFakeObserverFactory().factory,
    loadAboutAccountPayload: broker.loadAboutAccountPayload,
    abortControllerFactory: () => {
      const controller = createFakeAbortController();
      consumerControllers.push(controller);
      return controller;
    },
    onError,
  });
}

function transportFor(fetch) {
  return createXAboutAccountRequestTransport({
    fetch,
    createRequest: (identity) => ({
      url: `https://x.com/i/api/graphql/Injected_Integration_Id/AboutAccountQuery?${new URLSearchParams({
        variables: JSON.stringify({ screenName: identity.handle }),
      })}`,
      headers: { authorization: 'test-only', 'x-csrf-token': 'test-only' },
    }),
  });
}

it('shares a source-neutral lookup across profile and timeline sessions', async () => {
  const lookup = deferred();
  const sharedControllers = [];
  const consumerControllers = [];
  const loadPayload = vi.fn(() => lookup.promise);
  const broker = createXAboutAccountPayloadBroker({
    loadPayload,
    abortControllerFactory: () => {
      const controller = createFakeAbortController();
      sharedControllers.push(controller);
      return controller;
    },
    onError: vi.fn(),
  });
  const profile = profileRoot('OpenAI');
  const timeline = timelineRoot('openai');
  const profileSession = session(
    profile.root, 'profile', broker, { country: { highlight: ['JP'] } }, consumerControllers,
  );
  const timelineSession = session(
    timeline.root, 'timeline', broker, { country: { hide: ['JP'] } }, consumerControllers,
  );

  broker.start();
  expect(loadPayload).not.toHaveBeenCalled();
  profileSession.start();
  timelineSession.start();
  expect(loadPayload).toHaveBeenCalledTimes(1);
  expect(loadPayload.mock.calls[0][0]).toEqual({
    handle: 'openai', displayHandle: '@openai', profileUrl: 'https://x.com/openai',
    accountId: null, allowlistKey: '@openai', source: null,
  });
  expect(consumerControllers).toHaveLength(2);
  expect(consumerControllers[0].signal).not.toBe(consumerControllers[1].signal);

  profileSession.stop();
  expect(sharedControllers[0].abortCount).toBe(0);
  lookup.resolve(payload);
  await settle();
  expect(findLocationBadge(profile.root)).toBeNull();
  expect(findLocationBadge(timeline.name)).not.toBeNull();
  expect(getAccountAction(timeline.article)).toBe('hide');
  timelineSession.stop();
  expect(findLocationBadge(timeline.name)).toBeNull();
  expect(getAccountAction(timeline.article)).toBe('show');
  broker.stop();
  expect(broker.getInFlightCount()).toBe(0);
});

it('delivers one shared resolution to both active profile and timeline sessions', async () => {
  const lookup = deferred();
  const consumerControllers = [];
  const loadPayload = vi.fn(() => lookup.promise);
  const broker = createXAboutAccountPayloadBroker({
    loadPayload,
    abortControllerFactory: () => createFakeAbortController(),
    onError: vi.fn(),
  });
  const profile = profileRoot('OpenAI');
  const timeline = timelineRoot('openai');
  const profileSession = session(
    profile.root, 'profile', broker, { country: { highlight: ['JP'] } }, consumerControllers,
  );
  const timelineSession = session(
    timeline.root, 'timeline', broker, { country: { hide: ['JP'] } }, consumerControllers,
  );

  broker.start();
  profileSession.start();
  timelineSession.start();
  expect(loadPayload).toHaveBeenCalledTimes(1);
  lookup.resolve(payload);
  await settle();
  expect(findLocationBadge(profile.root)).not.toBeNull();
  expect(findLocationBadge(timeline.name)).not.toBeNull();
  expect(getAccountAction(profile.root)).toBe('highlight');
  expect(getAccountAction(timeline.article)).toBe('hide');
  expect(loadPayload).toHaveBeenCalledTimes(1);

  profileSession.stop();
  timelineSession.stop();
  expect(findLocationBadge(profile.root)).toBeNull();
  expect(findLocationBadge(timeline.name)).toBeNull();
  expect(getAccountAction(profile.root)).toBe('show');
  expect(getAccountAction(timeline.article)).toBe('show');
  broker.stop();
  expect(broker.getInFlightCount()).toBe(0);
});

it('starts independent lookups for different accounts across sessions', () => {
  const consumerControllers = [];
  const loadPayload = vi.fn(() => new Promise(() => {}));
  const broker = createXAboutAccountPayloadBroker({
    loadPayload,
    abortControllerFactory: () => createFakeAbortController(),
    onError: vi.fn(),
  });
  const profile = profileRoot('openai');
  const timeline = timelineRoot('anthropic');
  const profileSession = session(profile.root, 'profile', broker, {}, consumerControllers);
  const timelineSession = session(timeline.root, 'timeline', broker, {}, consumerControllers);
  broker.start();
  profileSession.start();
  timelineSession.start();
  expect(loadPayload).toHaveBeenCalledTimes(2);
  expect(broker.getInFlightCount()).toBe(2);
  profileSession.stop();
  timelineSession.stop();
  broker.stop();
});

it('passes transport JSON through the real parser, settings evaluation, and presentation', async () => {
  const responses = [
    { data: { user_result_by_screen_name: { result: {
      about_profile: { account_based_in: 'Canada' },
    } } } },
    { data: { user_result_by_screen_name: { result: { about_profile: {} } } } },
    { unsupported: true },
  ];
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: () => responses.shift() }));
  const transport = transportFor(fetch);
  const broker = createXAboutAccountPayloadBroker({
    loadPayload: transport.loadPayload,
    abortControllerFactory: () => createFakeAbortController(),
    onError: vi.fn(),
  }).start();

  for (const [expectedText, expectedAction] of [
    ['CA', 'hide'],
    ['🌐 Location not provided', 'show'],
    ['🌐 Location unavailable', 'show'],
  ]) {
    const profile = profileRoot('OpenAI');
    const current = session(
      profile.root, 'profile', broker, { country: { hide: ['CA'] } }, [],
    );
    current.start();
    await settle();
    await settle();
    expect(findLocationBadge(profile.root).textContent).toBe(expectedText);
    expect(getAccountAction(profile.root)).toBe(expectedAction);
    current.stop();
    expect(findLocationBadge(profile.root)).toBeNull();
    expect(getAccountAction(profile.root)).toBe('show');
  }
  expect(fetch).toHaveBeenCalledTimes(3);
  broker.stop();
});

it('cancels pending real transport work and never presents a stale response', async () => {
  const lookup = deferred();
  const sharedControllers = [];
  const fetch = vi.fn(() => lookup.promise);
  const transport = transportFor(fetch);
  const broker = createXAboutAccountPayloadBroker({
    loadPayload: transport.loadPayload,
    abortControllerFactory: () => {
      const controller = createFakeAbortController();
      sharedControllers.push(controller);
      return controller;
    },
    onError: vi.fn(),
  }).start();
  const profile = profileRoot('OpenAI');
  const current = session(profile.root, 'profile', broker, {}, []);
  current.start();
  current.stop();
  expect(sharedControllers[0].signal.aborted).toBe(true);
  lookup.resolve({ ok: true, status: 200, json: () => payload });
  await settle();
  expect(findLocationBadge(profile.root)).toBeNull();
  expect(getAccountAction(profile.root)).toBe('show');
  expect(broker.getInFlightCount()).toBe(0);
  broker.stop();
});

it('normalizes a real transport failure through processor presentation and retries fresh', async () => {
  const fetch = vi.fn(() => Promise.reject(new Error('private network detail')));
  const createRequest = vi.fn((identity) => ({
    url: `https://x.com/i/api/graphql/Injected_Failure_Id/AboutAccountQuery?${new URLSearchParams({
      variables: JSON.stringify({ screenName: identity.handle }),
    })}`,
    headers: { authorization: 'private auth', 'x-csrf-token': 'private csrf' },
  }));
  const transport = createXAboutAccountRequestTransport({ fetch, createRequest });
  const broker = createXAboutAccountPayloadBroker({
    loadPayload: transport.loadPayload,
    abortControllerFactory: () => createFakeAbortController(),
    onError: vi.fn(),
  }).start();
  const errors = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const profile = profileRoot('OpenAI');
    const current = session(profile.root, 'profile', broker, {}, [], (error) => {
      errors.push(error.message);
    });
    current.start();
    await settle();
    await settle();
    expect(findLocationBadge(profile.root).textContent).toBe('🌐 Location unavailable');
    expect(getAccountAction(profile.root)).toBe('show');
    expect(broker.getInFlightCount()).toBe(0);
    current.stop();
    expect(findLocationBadge(profile.root)).toBeNull();
    expect(getAccountAction(profile.root)).toBe('show');
  }
  expect(errors).toEqual(['Unable to load account location', 'Unable to load account location']);
  expect(JSON.stringify(errors)).not.toMatch(/private|auth|csrf|Injected/);
  expect(createRequest).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  broker.stop();
});
