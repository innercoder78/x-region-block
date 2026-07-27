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
      'start', 'stop', 'reconcile', 'rescan', 'retryRecoverable', 'getRoute', 'getPlans', 'getTargets',
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

  it('ignores inherited base URLs without reading inherited getters', () => {
    const root = new FakeDocument();
    const fixture = setup('https://x.com/home');
    const inherited = vi.fn(() => { throw new Error('must not read'); });
    Object.defineProperty(Object.prototype, 'baseUrl', { configurable: true, get: inherited });
    try {
      const controller = createXAccountTargetRouteSessionController(root, fixture.options);
      expect(inherited).not.toHaveBeenCalled();
      expect(controller.getPlans()).toEqual([]);
    } finally { delete Object.prototype.baseUrl; }
  });

  it.each([undefined, null, Object.freeze({ identity: true })])(
    'reads and preserves one own baseUrl value %s',
    (baseUrl) => {
      const fixture = setup('https://x.com/home');
      let reads = 0;
      const options = { ...fixture.options };
      Object.defineProperty(options, 'baseUrl', {
        enumerable: true,
        get() { reads += 1; return baseUrl; },
      });
      const controller = createXAccountTargetRouteSessionController(new FakeDocument(), options);
      expect(reads).toBe(1);
      controller.start();
      expect(controller.getPlans()[0].baseUrl).toBe(baseUrl);
      expect(reads).toBe(1);
      controller.stop();
    },
  );

  it('normalizes a throwing own baseUrl getter', () => {
    const fixture = setup();
    const options = { ...fixture.options };
    Object.defineProperty(options, 'baseUrl', { get() { throw new Error('private'); } });
    expect(() => createXAccountTargetRouteSessionController(new FakeDocument(), options))
      .toThrowError(new TypeError('Invalid account target route session options'));
  });

  it('normalizes reflective navigation-observer method failures and retries cleanly', () => {
    const fixture = setup();
    const invalid = {};
    for (const key of ['start', 'stop', 'getCurrentUrl', 'isActive']) {
      Object.defineProperty(invalid, key, {
        enumerable: true,
        get() { if (key === 'getCurrentUrl') throw new Error('private'); return vi.fn(); },
      });
    }
    fixture.options.navigationObserverFactory
      .mockReturnValueOnce(invalid)
      .mockImplementationOnce(() => fixture.navigation);
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    expect(() => controller.start()).toThrowError(
      new TypeError('navigationObserverFactory returned an invalid observer'),
    );
    expect(controller.isActive()).toBe(false);
    expect(controller.start()).toEqual([]);
    controller.stop();
  });

  it('owns a candidate before start and completes broker-last cleanup after reentrant stop', () => {
    const fixture = setup('https://x.com/i/bookmarks');
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    fixture.options.settingsRuntime.getSettings.mockImplementationOnce(() => {
      controller.stop();
      return {};
    });
    fixture.getObserverOptions().onNavigate('https://x.com/home');
    expect(controller.isActive()).toBe(false);
    expect(fixture.navigation.stop).toHaveBeenCalledOnce();
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledOnce();
    expect(fixture.options.settingsRuntime.subscribe.mock.results[0].value).toHaveBeenCalledOnce();
    expect(fixture.options.brokerAbortControllerFactory).not.toHaveBeenCalled();
    expect(controller.getRoute()).toBeNull();
    expect(controller.getPlans()).toEqual([]);
  });

  it('does not construct a second initial-profile candidate after reentrant final stop', () => {
    const fixture = setup('https://x.com/openai');
    let controller;
    fixture.options.settingsRuntime.getSettings.mockImplementationOnce(() => {
      controller.stop();
      return {};
    });
    controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
    expect(controller.start()).toEqual([]);
    expect(controller.isActive()).toBe(false);
    expect(fixture.options.settingsRuntime.getSettings).toHaveBeenCalledTimes(1);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(1);
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(controller.getRoute()).toBeNull();
    expect(controller.getPlans()).toEqual([]);
    controller.stop();
    expect(fixture.navigation.stop).toHaveBeenCalledTimes(1);

    fixture.setUrl('https://x.com/home');
    fixture.options.settingsRuntime.getSettings.mockReturnValue({});
    expect(controller.start()).toEqual([]);
    expect(controller.isActive()).toBe(true);
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
    expect(fixture.options.navigationObserverFactory).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it.each(['subscription', 'observer construction'])(
    'prevents the second profile candidate after stop during first-candidate %s',
    (stage) => {
      const fixture = setup('https://x.com/openai');
      let controller;
      if (stage === 'subscription') {
        fixture.options.settingsRuntime.subscribe.mockImplementation(() => {
          controller.stop();
          return vi.fn();
        });
      } else {
        fixture.options.observerFactory = vi.fn(() => {
          controller.stop();
          return { observe: vi.fn(), disconnect: vi.fn() };
        });
      }
      controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
      expect(controller.start()).toEqual([]);
      expect(controller.isActive()).toBe(false);
      expect(fixture.options.settingsRuntime.getSettings).toHaveBeenCalledTimes(1);
      expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(1);
      if (stage === 'observer construction') {
        expect(fixture.options.observerFactory).toHaveBeenCalledTimes(1);
      }
      expect(fixture.options.onError).not.toHaveBeenCalled();
      expect(controller.getRoute()).toBeNull();
      expect(controller.getPlans()).toEqual([]);
      expect(fixture.navigation.stop).toHaveBeenCalledTimes(1);
      controller.stop();
      expect(fixture.navigation.stop).toHaveBeenCalledTimes(1);
    },
  );

  it('discards transaction-wide candidate errors when a later initial candidate fails', () => {
    const fixture = setup('https://x.com/openai');
    let settingsReads = 0;
    fixture.options.settingsRuntime.getSettings.mockImplementation(() => {
      settingsReads += 1;
      if (settingsReads === 2) throw new Error('private startup failure');
      return {};
    });
    fixture.options.settingsRuntime.subscribe.mockImplementation((listener) => {
      listener(null);
      return vi.fn();
    });
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    expect(() => controller.start()).toThrowError(new Error('private startup failure'));
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
    expect(controller.getRoute()).toBeNull();
    expect(controller.getPlans()).toEqual([]);
  });

  it('reports only one generic error when a later active candidate fails', () => {
    const fixture = setup('https://x.com/i/bookmarks');
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    let settingsReads = 0;
    fixture.options.settingsRuntime.getSettings.mockImplementation(() => {
      settingsReads += 1;
      if (settingsReads === 2) throw new Error('private reconciliation failure');
      return {};
    });
    fixture.options.settingsRuntime.subscribe.mockImplementation((listener) => {
      listener(null);
      return vi.fn();
    });
    fixture.getObserverOptions().onNavigate('https://x.com/openai');
    expect(fixture.options.onError).toHaveBeenCalledTimes(1);
    expect(fixture.options.onError).toHaveBeenCalledWith(
      new Error('Unable to reconcile X account target route'),
    );
    expect(controller.getRoute().type).toBe('unsupported');
    expect(controller.getPlans()).toEqual([]);
    expect(controller.isActive()).toBe(true);
    fixture.options.settingsRuntime.getSettings.mockReturnValue({});
    fixture.options.settingsRuntime.subscribe.mockImplementation(() => vi.fn());
    fixture.setUrl('https://x.com/openai');
    controller.reconcile();
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['profile', 'timeline']);
    controller.stop();
  });

  it('reuses canonical sessions through the required multi-route transition sequence', () => {
    const fixture = setup('https://x.com/home');
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(1);
    fixture.getObserverOptions().onNavigate('https://x.com/openai');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['profile', 'timeline']);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(2);
    fixture.getObserverOptions().onNavigate('https://x.com/openai/with_replies');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['profile', 'reply']);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(3);
    fixture.getObserverOptions().onNavigate('https://x.com/openai/status/1');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['reply']);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(3);
    fixture.getObserverOptions().onNavigate('https://x.com/home');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(4);
    expect(fixture.options.navigationObserverFactory).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it.each([
    ['https://x.com/openai', 'https://x.com/anthropic'],
    ['https://x.com/openai', 'https://x.com/openai/media'],
    ['https://x.com/openai/status/1', 'https://x.com/openai/status/2'],
    ['https://x.com/explore/tabs/news', 'https://x.com/explore/tabs/sports'],
    ['https://x.com/search?q=one', 'https://x.com/search?q=two'],
  ])('does no session work for policy-equivalent navigation %s to %s', (initial, next) => {
    const fixture = setup(initial);
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    const subscriptions = fixture.options.settingsRuntime.subscribe.mock.calls.length;
    const observers = fixture.options.observerFactory.mock?.calls.length
      ?? fixture.options.settingsRuntime.subscribe.mock.calls.length;
    fixture.getObserverOptions().onNavigate(next);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(subscriptions);
    expect(fixture.options.observerFactory.mock?.calls.length ?? subscriptions).toBe(observers);
    expect(fixture.options.navigationObserverFactory).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('replaces search with notification and cleans supported routes to unsupported', () => {
    const fixture = setup('https://x.com/search?q=one');
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    fixture.getObserverOptions().onNavigate('https://x.com/notifications');
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['notification']);
    expect(fixture.options.settingsRuntime.subscribe).toHaveBeenCalledTimes(2);
    fixture.getObserverOptions().onNavigate('https://x.com/i/bookmarks');
    expect(controller.getPlans()).toEqual([]);
    expect(controller.getTargets()).toEqual([]);
    expect(controller.isActive()).toBe(true);
    expect(fixture.navigation.stop).not.toHaveBeenCalled();
    controller.stop();
  });

  it('adopts a valid observer returned after factory-time final stop without starting it', () => {
    const fixture = setup('https://x.com/home');
    let controller;
    fixture.options.navigationObserverFactory.mockImplementationOnce(() => {
      controller.stop();
      return fixture.navigation;
    });
    controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
    expect(controller.start()).toEqual([]);
    expect(controller.isActive()).toBe(false);
    expect(fixture.navigation.start).not.toHaveBeenCalled();
    expect(fixture.navigation.stop).toHaveBeenCalledOnce();
    expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(controller.getRoute()).toBeNull();
    expect(controller.getInFlightCount()).toBe(0);
    fixture.options.navigationObserverFactory.mockImplementation(() => fixture.navigation);
    expect(controller.start()).toEqual([]);
    expect(controller.isActive()).toBe(true);
    controller.stop();
  });

  it('suppresses a factory exception after factory-time final stop', () => {
    const fixture = setup();
    let controller;
    fixture.options.navigationObserverFactory.mockImplementation(() => {
      controller.stop();
      throw new Error('private factory failure');
    });
    controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
    expect(() => controller.start()).not.toThrow();
    expect(controller.isActive()).toBe(false);
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
  });

  it('buffers factory callbacks until initial route commit and keeps only the latest URL', () => {
    const fixture = setup('https://x.com/i/bookmarks');
    const observerError = new Error('privacy-safe observer error');
    fixture.options.navigationObserverFactory.mockImplementation((observerOptions) => {
      observerOptions.onNavigate('https://x.com/search?q=discarded');
      observerOptions.onNavigate('https://x.com/home');
      observerOptions.onError(observerError);
      return fixture.navigation;
    });
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
    expect(fixture.options.settingsRuntime.getSettings).toHaveBeenCalledTimes(1);
    expect(fixture.options.onError).toHaveBeenCalledTimes(1);
    expect(fixture.options.onError).toHaveBeenCalledWith(observerError);
    controller.stop();
  });

  it('discards factory callbacks when returned observer validation fails', () => {
    const fixture = setup();
    fixture.options.navigationObserverFactory.mockImplementation((observerOptions) => {
      observerOptions.onNavigate('https://x.com/home');
      observerOptions.onError(new Error('private observer error'));
      return {};
    });
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    expect(() => controller.start()).toThrowError(
      new TypeError('navigationObserverFactory returned an invalid observer'),
    );
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it('stops reflective validation and adopts the captured stop method after final stop', () => {
    const fixture = setup();
    let controller;
    const reads = [];
    const observer = {};
    for (const key of ['stop', 'start', 'getCurrentUrl', 'isActive']) {
      Object.defineProperty(observer, key, {
        enumerable: true,
        get() {
          reads.push(key);
          if (key === 'start') controller.stop();
          return fixture.navigation[key];
        },
      });
    }
    fixture.options.navigationObserverFactory.mockReturnValue(observer);
    controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
    expect(controller.start()).toEqual([]);
    expect(reads).toEqual(['stop', 'start']);
    expect(fixture.navigation.start).not.toHaveBeenCalled();
    expect(fixture.navigation.stop).toHaveBeenCalledOnce();
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it('buffers observer-start callbacks and reconciles only the latest after initial commit', () => {
    const fixture = setup('https://x.com/i/bookmarks');
    const observerError = new Error('startup observer error');
    fixture.options.navigationObserverFactory.mockImplementation((observerOptions) => ({
      start: vi.fn(() => {
        expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
        observerOptions.onNavigate('https://x.com/search?q=discarded');
        observerOptions.onNavigate('https://x.com/home');
        observerOptions.onError(observerError);
        expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
        return 'https://x.com/i/bookmarks';
      }),
      stop: vi.fn(), getCurrentUrl: vi.fn(), isActive: vi.fn(() => true),
    }));
    const controller = createXAccountTargetRouteSessionController(
      new FakeDocument(), fixture.options,
    );
    controller.start();
    expect(controller.getPlans().map(({ source }) => source)).toEqual(['timeline']);
    expect(fixture.options.settingsRuntime.getSettings).toHaveBeenCalledTimes(1);
    expect(fixture.options.onError).toHaveBeenCalledWith(observerError);
    controller.stop();
  });

  it('adopts and stops an observer when final stop occurs inside observer start', () => {
    const fixture = setup('https://x.com/home');
    let controller;
    const observer = {
      start: vi.fn(() => {
        controller.stop();
        return 'https://x.com/home';
      }),
      stop: vi.fn(), getCurrentUrl: vi.fn(), isActive: vi.fn(() => true),
    };
    fixture.options.navigationObserverFactory.mockReturnValue(observer);
    controller = createXAccountTargetRouteSessionController(new FakeDocument(), fixture.options);
    expect(controller.start()).toEqual([]);
    expect(observer.start).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
    expect(fixture.options.settingsRuntime.getSettings).not.toHaveBeenCalled();
    expect(fixture.options.onError).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
    expect(controller.getRoute()).toBeNull();
  });
});
