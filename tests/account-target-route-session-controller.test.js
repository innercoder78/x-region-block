import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION,
  createXAccountTargetRouteSessionController,
} from '../src/content/account-target-route-session-controller.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function setup(initialUrl = 'https://x.com/home') {
  const mutation = createFakeObserverFactory();
  const runtime = { getSettings: vi.fn(() => ({})), subscribe: vi.fn(() => vi.fn()) };
  let observerOptions;
  let url = initialUrl;
  const navigation = {
    start: vi.fn(() => url), stop: vi.fn(), getCurrentUrl: vi.fn(() => url), isActive: vi.fn(() => true),
  };
  const options = {
    settingsRuntime: runtime,
    observerFactory: mutation.factory,
    loadPayload: vi.fn(() => ({})),
    brokerAbortControllerFactory: vi.fn(createFakeAbortController),
    consumerAbortControllerFactory: vi.fn(createFakeAbortController),
    navigationObserverFactory: vi.fn((value) => { observerOptions = value; return navigation; }),
    onError: vi.fn(),
  };
  return { options, navigation, getObserverOptions: () => observerOptions, setUrl: (value) => { url = value; } };
}

describe('dynamic account-target route sessions', () => {
  it('exports version 1 and the exact frozen inactive API', () => {
    const root = new FakeDocument();
    const { options } = setup();
    const controller = createXAccountTargetRouteSessionController(root, options);
    expect(ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION).toBe(1);
    expect(Object.keys(controller)).toEqual([
      'start', 'stop', 'reconcile', 'rescan', 'getRoute', 'getPlans', 'getTargets',
      'getInFlightCount', 'isActive',
    ]);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(controller.getRoute()).toBeNull();
    expect(controller.getPlans()).toBe(controller.getTargets());
  });

  it('keeps its broker and observer alive on unsupported routes and can reconcile later', () => {
    const root = new FakeDocument();
    const fixture = setup('https://x.com/i/bookmarks');
    const controller = createXAccountTargetRouteSessionController(root, fixture.options);
    expect(controller.start()).toEqual([]);
    expect(controller.getRoute().type).toBe('unsupported');
    expect(fixture.navigation.stop).not.toHaveBeenCalled();
    fixture.setUrl('https://x.com/home');
    fixture.getObserverOptions().onNavigate('https://x.com/home');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
    expect(fixture.options.navigationObserverFactory).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(fixture.navigation.stop).toHaveBeenCalledTimes(1);
    expect(controller.getRoute()).toBeNull();
  });

  it('rejects roots, unsupported account IDs, and extra options without starting dependencies', () => {
    const fixture = setup();
    expect(() => createXAccountTargetRouteSessionController({}, fixture.options)).toThrowError(
      new TypeError('Invalid account target route session root'),
    );
    expect(() => createXAccountTargetRouteSessionController(new FakeDocument(), {
      ...fixture.options, accountId: '1',
    })).toThrowError(new TypeError('accountId is not supported by account target route sessions'));
    expect(() => createXAccountTargetRouteSessionController(new FakeDocument(), {
      ...fixture.options, extra: true,
    })).toThrowError(new TypeError('Invalid account target route session options'));
    expect(fixture.options.navigationObserverFactory).not.toHaveBeenCalled();
  });
});
