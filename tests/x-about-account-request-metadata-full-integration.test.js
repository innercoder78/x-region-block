import { expect, it, vi } from 'vitest';
import { createXAccountTargetSession } from '../src/content/account-target-session.js';
import { createXAboutAccountPayloadBroker } from '../src/content/x-about-account-payload-broker.js';
import { createXAboutAccountRequestMetadataBridge } from '../src/content/x-about-account-request-metadata-bridge.js';
import { createXAboutAccountRequestTransport } from '../src/content/x-about-account-request-transport.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { installXAboutAccountRequestCapture } from '../src/page/x-about-account-request-capture.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

const settle = () => Promise.resolve().then(() => Promise.resolve());
function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
function target(handle, timeline = false) {
  const document = new FakeDocument();
  const root = timeline ? document : document.createElement('div');
  const presentation = timeline ? document.createElement('article') : root;
  const name = timeline ? document.createElement('div') : root;
  if (timeline) {
    presentation.setAttribute('data-testid', 'tweet');
    name.setAttribute('data-testid', 'User-Name');
    presentation.appendChild(name);
    document.appendChild(presentation);
  } else {
    root.setAttribute('data-testid', 'UserName');
    document.appendChild(root);
  }
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link);
  return { root, presentation, name };
}
function makeSession(targetValue, source, broker, controllers) {
  return createXAccountTargetSession(targetValue.root, {
    source,
    settingsRuntime: {
      getSettings: () => ({ country: { hide: ['JP'] } }), subscribe: () => () => {},
    },
    observerFactory: createFakeObserverFactory().factory,
    loadAboutAccountPayload: broker.loadAboutAccountPayload,
    abortControllerFactory: () => {
      const controller = createFakeAbortController();
      controllers.push(controller);
      return controller;
    },
    onError: vi.fn(),
  });
}

it('composes captured metadata through broker, parser, settings, badge, and action', async () => {
  const pageFetch = vi.fn(() => 'page-result');
  const { page, content } = metadataFacades(pageFetch);
  const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: vi.fn() });
  bridge.start();
  const capture = installXAboutAccountRequestCapture(page);
  expect(page.fetch(observedUrl('learned_runtime_query', 'Observed'), {
    headers: observedHeaders,
  })).toBe('page-result');
  expect(bridge.hasSnapshot()).toBe(true);

  const firstLookup = deferred();
  const secondLookup = deferred();
  const thirdLookup = deferred();
  const missingLookup = deferred();
  const unavailableLookup = deferred();
  const lookups = [firstLookup, secondLookup, thirdLookup, missingLookup, unavailableLookup];
  const transportFetch = vi.fn(() => lookups.shift().promise);
  const requestedIdentities = [];
  const transport = createXAboutAccountRequestTransport({
    fetch: transportFetch,
    createRequest(identity, context) {
      requestedIdentities.push(identity);
      return bridge.createRequest(identity, context);
    },
  });
  const sharedControllers = [];
  const broker = createXAboutAccountPayloadBroker({
    loadPayload: transport.loadPayload,
    abortControllerFactory: () => {
      const controller = createFakeAbortController();
      sharedControllers.push(controller);
      return controller;
    },
    onError: vi.fn(),
  }).start();
  const consumerControllers = [];
  const profile = target('OpenAI');
  const timeline = target('openai', true);
  const profileSession = makeSession(profile, 'profile', broker, consumerControllers);
  const timelineSession = makeSession(timeline, 'timeline', broker, consumerControllers);
  profileSession.start();
  timelineSession.start();
  expect(transportFetch).toHaveBeenCalledTimes(1);
  expect(requestedIdentities).toHaveLength(1);
  expect(requestedIdentities[0].source).toBeNull();
  expect(transportFetch.mock.calls[0][1].signal).toBe(sharedControllers[0].signal);
  expect(decodeURIComponent(transportFetch.mock.calls[0][0])).toContain('"screen_name":"openai"');
  expect(transportFetch.mock.calls[0][0]).not.toContain('Observed');

  const known = { data: { user_result_by_screen_name: { result: {
    about_profile: { account_based_in: 'Japan' },
  } } } };
  firstLookup.resolve({ ok: true, status: 200, json: () => known });
  await settle();
  await settle();
  expect(findLocationBadge(profile.root)).not.toBeNull();
  expect(findLocationBadge(timeline.name)).not.toBeNull();
  expect(getAccountAction(profile.root)).toBe('hide');
  expect(getAccountAction(timeline.presentation)).toBe('hide');
  profileSession.stop();
  expect(sharedControllers[0].abortCount).toBe(0);
  timelineSession.stop();
  expect(sharedControllers[0].abortCount).toBe(0);

  const fresh = target('openai');
  const freshTimeline = target('OpenAI', true);
  const freshSession = makeSession(fresh, 'profile', broker, consumerControllers);
  const freshTimelineSession = makeSession(
    freshTimeline, 'timeline', broker, consumerControllers,
  );
  freshSession.start();
  freshTimelineSession.start();
  expect(transportFetch).toHaveBeenCalledTimes(2);
  expect(sharedControllers).toHaveLength(2);
  freshSession.stop();
  expect(sharedControllers[1].abortCount).toBe(0);
  freshTimelineSession.stop();
  expect(sharedControllers[1].abortCount).toBe(1);
  expect(broker.getInFlightCount()).toBe(0);
  secondLookup.resolve({ ok: true, status: 200, json: () => known });
  await settle();
  expect(findLocationBadge(fresh.root)).toBeNull();
  expect(getAccountAction(fresh.root)).toBe('show');
  expect(findLocationBadge(freshTimeline.name)).toBeNull();
  expect(getAccountAction(freshTimeline.presentation)).toBe('show');

  const afterCancellation = target('openai');
  const afterCancellationSession = makeSession(
    afterCancellation, 'profile', broker, consumerControllers,
  );
  afterCancellationSession.start();
  expect(transportFetch).toHaveBeenCalledTimes(3);
  afterCancellationSession.stop();
  expect(sharedControllers[2].abortCount).toBe(1);
  expect(broker.getInFlightCount()).toBe(0);

  for (const [lookup, payload] of [
    [missingLookup, { data: { user_result_by_screen_name: { result: { about_profile: {} } } } }],
    [unavailableLookup, { malformed: true }],
  ]) {
    const locationTarget = target('openai');
    const locationSession = makeSession(
      locationTarget, 'profile', broker, consumerControllers,
    );
    locationSession.start();
    lookup.resolve({ ok: true, status: 200, json: () => payload });
    await settle();
    await settle();
    expect(findLocationBadge(locationTarget.root)).not.toBeNull();
    expect(getAccountAction(locationTarget.root)).toBe('show');
    locationSession.stop();
  }
  expect(transportFetch).toHaveBeenCalledTimes(5);

  bridge.stop();
  expect(bridge.hasSnapshot()).toBe(false);
  expect(() => bridge.createRequest(requestedIdentities[0], { version: 1 })).toThrow('not active');
  capture.stop();
  broker.stop();
  expect(pageFetch).toHaveBeenCalledTimes(1);
  await settle();
});
