import { expect, it, vi } from 'vitest';
import { createXAccountTargetSession } from '../src/content/account-target-session.js';
import { createXAboutAccountPayloadBroker } from '../src/content/x-about-account-payload-broker.js';
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
  article.appendChild(name);
  document.appendChild(article);
  return { root: document, article, name };
}
function session(root, source, broker, settings, consumerControllers) {
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
    onError: vi.fn(),
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
