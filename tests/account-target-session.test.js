import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_SESSION_VERSION,
  createXAccountTargetSession,
} from '../src/content/account-target-session.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import {
  ACCOUNT_ACTION_ATTRIBUTE,
  getAccountAction,
} from '../src/content/account-action-renderer.js';

const payload = (location = 'Japan') => ({
  data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: location } } } },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function appendTimelineTarget(root, handle) {
  const document = root.ownerDocument ?? root;
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const shell = document.createElement('div'); const column = document.createElement('div');
  const row = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link); row.appendChild(name); column.appendChild(row); shell.appendChild(column);
  article.appendChild(shell);
  root.appendChild(article);
  return { article, name, link };
}

const settle = () => Promise.resolve().then(() => Promise.resolve());
const spyAbortController = () => ({
  signal: Object.freeze({ aborted: false, addEventListener() {}, removeEventListener() {} }),
  abort: vi.fn(),
});

function dependencies(overrides = {}) {
  const fakeObservers = createFakeObserverFactory();
  const listeners = [];
  const runtime = {
    getSettings: vi.fn(() => ({})),
    subscribe: vi.fn((listener) => {
      listeners.push(listener);
      return vi.fn();
    }),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const options = {
    source: 'timeline',
    settingsRuntime: runtime,
    observerFactory: fakeObservers.factory,
    loadAboutAccountPayload: vi.fn(() => ({})),
    abortControllerFactory: vi.fn(spyAbortController),
    onError: vi.fn(),
    ...overrides,
  };
  return { options, runtime, listeners, fakeObservers };
}

describe('account target session API and validation', () => {
  it('exports version 1 and an exact frozen controller', () => {
    const { options } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    expect(ACCOUNT_TARGET_SESSION_VERSION).toBe(1);
    expect(Object.keys(session)).toEqual(['start', 'stop', 'rescan', 'retryRecoverable', 'getTargets', 'isActive']);
    expect(Object.isFrozen(session)).toBe(true);
    expect(session.getTargets()).toBe(session.getTargets());
    expect(Object.isFrozen(session.getTargets())).toBe(true);
  });

  it.each([null, [], 'options', 1, () => {}, new (class Options {})()])(
    'rejects a non-plain options container',
    (options) => {
      expect(() => createXAccountTargetSession(new FakeDocument(), options))
        .toThrow(new TypeError('account target session options must be a plain object'));
    },
  );

  it('accepts null-prototype options and canonicalizes the source', () => {
    const { options } = dependencies();
    const nullOptions = Object.assign(Object.create(null), options, { source: ' TiMeLiNe ' });
    const session = createXAccountTargetSession(new FakeDocument(), nullOptions);
    expect(session.start()).toEqual([]);
    session.stop();
  });

  it.each([null, [], {}, { querySelectorAll: null }])('rejects an invalid root', (root) => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(root, options))
      .toThrow(new TypeError('Invalid account target session root'));
  });

  it('rejects missing sources and an own account ID while ignoring inherited values', () => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(new FakeDocument(), { ...options, source: undefined }))
      .toThrow(new TypeError('Invalid account target session source'));
    expect(() => createXAccountTargetSession(new FakeDocument(), { ...options, accountId: '1' }))
      .toThrow(new TypeError('accountId is not supported by account target sessions'));
    const inherited = Object.create({ source: 'timeline', accountId: '1' });
    Object.assign(inherited, options);
    delete inherited.source;
    expect(() => createXAccountTargetSession(new FakeDocument(), inherited))
      .toThrow(new TypeError('account target session options must be a plain object'));
  });

  it.each([
    ['settingsRuntime', null, 'settingsRuntime must provide getSettings and subscribe'],
    ['observerFactory', null, 'observerFactory must be a function'],
    ['loadAboutAccountPayload', null, 'loadAboutAccountPayload must be a function'],
    ['abortControllerFactory', null, 'abortControllerFactory must be a function'],
    ['onError', null, 'onError must be a function'],
  ])('validates %s', (property, value, message) => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(
      new FakeDocument(), { ...options, [property]: value },
    )).toThrow(new TypeError(message));
  });
});

describe('account target session lifecycle', () => {
  it('starts lazily, subscribes once, rescans, and is idempotent', () => {
    const { options, runtime, fakeObservers } = dependencies();
    const root = new FakeDocument();
    const session = createXAccountTargetSession(root, options);
    expect(runtime.getSettings).not.toHaveBeenCalled();
    const started = session.start();
    expect(started).toBe(session.getTargets());
    expect(runtime.getSettings).toHaveBeenCalledTimes(1);
    expect(runtime.subscribe).toHaveBeenCalledTimes(1);
    expect(fakeObservers.instances).toHaveLength(1);
    expect(fakeObservers.instances[0].observations[0].target).toBe(root);
    expect(session.start()).toBe(started);
    expect(session.rescan()).toBe(started);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it('forwards settings errors generically and ignores an old listener', () => {
    const { options, listeners } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    listeners[0](null);
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to apply account target settings'),
    );
    expect(session.isActive()).toBe(true);
    session.stop();
    options.onError.mockClear();
    listeners[0]({});
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('stops, clears targets, and restarts with fresh dependencies', () => {
    const { options, runtime, fakeObservers } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    const unsubscribe = runtime.subscribe.mock.results[0].value;
    session.stop();
    expect(fakeObservers.instances[0].disconnectCount).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.isActive()).toBe(false);
    expect(session.getTargets()).toEqual([]);
    session.stop();
    session.start();
    expect(fakeObservers.instances).toHaveLength(2);
    expect(runtime.subscribe).toHaveBeenCalledTimes(2);
  });

  it('requires current settings and a callable unsubscriber', () => {
    const missing = dependencies();
    missing.runtime.getSettings.mockReturnValue(null);
    const missingSession = createXAccountTargetSession(new FakeDocument(), missing.options);
    expect(() => missingSession.start())
      .toThrow(new TypeError('settings runtime has no current settings'));
    expect(missingSession.isActive()).toBe(false);

    const invalid = dependencies();
    invalid.runtime.subscribe.mockReturnValue(null);
    const invalidSession = createXAccountTargetSession(new FakeDocument(), invalid.options);
    expect(() => invalidSession.start())
      .toThrow(new TypeError('settingsRuntime.subscribe must return an unsubscribe function'));
    expect(invalidSession.isActive()).toBe(false);
    expect(invalidSession.getTargets()).toEqual([]);
  });

  it('continues failed cleanup and reports only one generic stop error', () => {
    const order = [];
    const { options, runtime } = dependencies({
      onError: vi.fn(() => { throw new Error('callback failure'); }),
    });
    options.observerFactory = (callback) => ({
      observe: vi.fn(),
      disconnect: () => { order.push('observer'); throw new Error('disconnect'); },
      callback,
    });
    runtime.subscribe.mockReturnValue(() => {
      order.push('unsubscribe');
      throw new Error('unsubscribe');
    });
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    expect(() => session.stop()).not.toThrow();
    expect(order).toEqual(['observer', 'unsubscribe']);
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to stop account target session'),
    );
    expect(session.isActive()).toBe(false);
  });

  it('converts a synchronous processor cleanup report into one session stop error', () => {
    const { options } = dependencies({
      loadAboutAccountPayload: vi.fn(() => new Promise(() => {})),
      abortControllerFactory: vi.fn(() => createFakeAbortController({ failAbort: true })),
    });
    const root = new FakeDocument();
    appendTimelineTarget(root, 'openai');
    const session = createXAccountTargetSession(root, options);
    session.start();
    session.stop();
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to stop account target session'),
    );
    session.stop();
    expect(options.onError).toHaveBeenCalledTimes(1);
  });

  it('rejects rescanning while inactive', () => {
    const { options } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    expect(() => session.rescan())
      .toThrow(new TypeError('account target session is not active'));
  });
});

describe('account target session integration', () => {
  it('composes discovery, lookup, presentation, settings, mutations, and cleanup', async () => {
    const document = new FakeDocument();
    const first = appendTimelineTarget(document, 'openai');
    const firstLookup = deferred();
    const secondLookup = deferred();
    const lookups = [firstLookup, secondLookup];
    const controllers = [];
    const { options, runtime, listeners, fakeObservers } = dependencies({
      source: 'timeline',
      loadAboutAccountPayload: vi.fn(() => lookups.shift().promise),
      abortControllerFactory: vi.fn(() => {
        const controller = spyAbortController();
        controllers.push(controller);
        return controller;
      }),
    });
    runtime.getSettings.mockReturnValue({ country: { hide: ['JP'] } });
    const session = createXAccountTargetSession(document, options);

    const initial = session.start();
    expect(initial).toHaveLength(1);
    expect(initial[0].accountContainer).toBe(first.article);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);
    firstLookup.resolve(payload());
    await settle();
    expect(findLocationBadge(first.name)).not.toBeNull();
    expect(getAccountAction(first.article)).toBe('hide');

    listeners[0]({ country: { highlight: ['JP'] } });
    expect(getAccountAction(first.article)).toBe('highlight');
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);

    const second = appendTimelineTarget(document, 'anthropic');
    fakeObservers.instances[0].trigger([{}]);
    await settle();
    expect(session.getTargets()).toHaveLength(2);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);

    document.children.splice(document.children.indexOf(first.article), 1);
    first.article.parentNode = null;
    fakeObservers.instances[0].trigger([{}]);
    await settle();
    expect(session.getTargets()).toHaveLength(1);
    expect(findLocationBadge(first.name)).toBeNull();
    expect(first.article.hasAttribute(ACCOUNT_ACTION_ATTRIBUTE)).toBe(false);

    session.stop();
    expect(findLocationBadge(second.name)).toBeNull();
    expect(second.article.hasAttribute(ACCOUNT_ACTION_ATTRIBUTE)).toBe(false);
    expect(controllers[1].abort).toHaveBeenCalledTimes(1);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
    secondLookup.resolve(payload('Canada'));
    await settle();
    expect(findLocationBadge(second.name)).toBeNull();
  });

  it('establishes subscription before initial scan and creates no duplicate work', () => {
    const order = [];
    const document = new FakeDocument();
    appendTimelineTarget(document, 'openai');
    const originalQuery = document.querySelectorAll.bind(document);
    document.querySelectorAll = (selector) => {
      order.push('scan');
      return originalQuery(selector);
    };
    const fakeObservers = createFakeObserverFactory();
    const runtime = {
      getSettings() { order.push('getSettings'); return {}; },
      subscribe(listener) { order.push('subscribe'); this.listener = listener; return () => {}; },
    };
    const options = {
      source: 'timeline',
      settingsRuntime: runtime,
      observerFactory(callback) {
        order.push('observerFactory');
        const observer = fakeObservers.factory(callback);
        const observe = observer.observe.bind(observer);
        observer.observe = (...args) => { order.push('observe'); return observe(...args); };
        return observer;
      },
      loadAboutAccountPayload: vi.fn(() => { order.push('lookup'); return payload(); }),
      abortControllerFactory: spyAbortController,
      onError: vi.fn(),
    };
    const session = createXAccountTargetSession(document, options);
    session.start();
    expect(order).toEqual([
      'getSettings', 'subscribe', 'observerFactory', 'observe', 'scan', 'lookup',
    ]);
    session.start();
    expect(order).toHaveLength(6);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);
    session.stop();
    session.start();
    expect(fakeObservers.instances).toHaveLength(2);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['show', {}, null],
    ['highlight', { country: { highlight: ['JP'] } }, 'highlight'],
    ['hide', { country: { hide: ['JP'] } }, 'hide'],
    ['allowlist', { country: { hide: ['JP'] }, allowlist: ['@openai'] }, null],
    ['always show', { country: { hide: ['JP'], alwaysShow: ['JP'] } }, null],
  ])('reevaluates resolved targets for %s without another lookup', async (
    _name, nextSettings, expectedAttribute,
  ) => {
    const document = new FakeDocument();
    const target = appendTimelineTarget(document, 'openai');
    const { options, runtime, listeners } = dependencies();
    options.loadAboutAccountPayload.mockReturnValue(payload());
    runtime.getSettings.mockReturnValue({ country: { hide: ['JP'] } });
    const session = createXAccountTargetSession(document, options);
    session.start();
    await settle();
    listeners[0](nextSettings);
    expect(target.article.getAttribute(ACCOUNT_ACTION_ATTRIBUTE)).toBe(expectedAttribute);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);
  });

  it('preserves settings atomically after an invalid update and recovers later', async () => {
    const document = new FakeDocument();
    const target = appendTimelineTarget(document, 'openai');
    const { options, runtime, listeners } = dependencies();
    options.loadAboutAccountPayload.mockReturnValue(payload());
    runtime.getSettings.mockReturnValue({ country: { hide: ['JP'] } });
    const session = createXAccountTargetSession(document, options);
    session.start();
    await settle();
    listeners[0]({ country: { hide: 'JP' } });
    expect(getAccountAction(target.article)).toBe('hide');
    expect(options.onError).toHaveBeenLastCalledWith(
      new Error('Unable to apply account target settings'),
    );
    listeners[0]({ country: { highlight: ['JP'] } });
    expect(getAccountAction(target.article)).toBe('highlight');
    expect(session.isActive()).toBe(true);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);
  });

  it('applies immediate subscription delivery before initial presentation', async () => {
    const document = new FakeDocument();
    const target = appendTimelineTarget(document, 'openai');
    const { options, runtime } = dependencies();
    options.loadAboutAccountPayload.mockReturnValue(payload());
    runtime.subscribe.mockImplementation((listener) => {
      listener({ country: { highlight: ['JP'] } });
      return vi.fn();
    });
    createXAccountTargetSession(document, options).start();
    await settle();
    expect(getAccountAction(target.article)).toBe('highlight');
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(1);
  });

  it('preserves unknown-location rules and forwards current processor errors once', async () => {
    const document = new FakeDocument();
    const target = appendTimelineTarget(document, 'openai');
    const { options, runtime } = dependencies();
    runtime.getSettings.mockReturnValue({ other: { hide: ['unknown'] } });
    options.loadAboutAccountPayload.mockReturnValue(payload('Atlantis'));
    createXAccountTargetSession(document, options).start();
    await settle();
    expect(getAccountAction(target.article)).toBe('hide');
    expect(options.onError).not.toHaveBeenCalled();

    const rejectedDocument = new FakeDocument();
    appendTimelineTarget(rejectedDocument, 'anthropic');
    const rejected = dependencies();
    rejected.options.loadAboutAccountPayload.mockRejectedValue(new Error('private transport'));
    createXAccountTargetSession(rejectedDocument, rejected.options).start();
    await settle();
    expect(rejected.options.onError).toHaveBeenCalledTimes(1);
    const forwarded = rejected.options.onError.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(Error);
    expect(forwarded.message).toBe('Unable to load account location');
  });
});

describe('account target session startup rollback', () => {
  const cases = [
    ['getSettings throws', ({ runtime }, failure) => {
      runtime.getSettings.mockImplementationOnce(() => { throw failure; });
    }],
    ['missing settings', ({ runtime }, failure) => {
      runtime.getSettings.mockReturnValueOnce(undefined);
      failure.expected = new TypeError('settings runtime has no current settings');
    }],
    ['invalid initial settings', ({ runtime }, failure) => {
      runtime.getSettings.mockReturnValueOnce([]);
      failure.expected = new TypeError('settings must be a plain object');
    }],
    ['subscribe throws', ({ runtime }, failure) => {
      runtime.subscribe.mockImplementationOnce(() => { throw failure; });
    }],
    ['invalid unsubscribe', ({ runtime }, failure) => {
      runtime.subscribe.mockReturnValueOnce(null);
      failure.expected = new TypeError(
        'settingsRuntime.subscribe must return an unsubscribe function',
      );
    }],
    ['observer factory throws', ({ options }, failure) => {
      const goodFactory = options.observerFactory;
      let first = true;
      options.observerFactory = (callback) => {
        if (first) { first = false; throw failure; }
        return goodFactory(callback);
      };
    }],
    ['invalid observer', ({ options }, failure) => {
      const goodFactory = options.observerFactory;
      let first = true;
      options.observerFactory = (callback) => {
        if (first) { first = false; return {}; }
        return goodFactory(callback);
      };
      failure.expected = new TypeError('observerFactory returned an invalid observer');
    }],
    ['observe throws', ({ options }, failure) => {
      const goodFactory = options.observerFactory;
      let first = true;
      options.observerFactory = (callback) => {
        if (!first) return goodFactory(callback);
        first = false;
        return {
          observe() { throw failure; },
          disconnect: vi.fn(),
        };
      };
    }],
    ['initial discovery throws', ({ root }, failure) => {
      const query = root.querySelectorAll.bind(root);
      let first = true;
      root.querySelectorAll = (selector) => {
        if (first) { first = false; throw failure; }
        return query(selector);
      };
    }],
  ];

  it.each(cases)('rolls back when %s and permits a clean retry', (_name, configure) => {
    const root = new FakeDocument();
    const state = dependencies();
    state.root = root;
    const failure = new Error(`original ${_name}`);
    failure.expected = failure;
    configure(state, failure);
    const session = createXAccountTargetSession(root, state.options);
    const empty = session.getTargets();
    let thrown;
    try { session.start(); } catch (error) { thrown = error; }
    if (failure.expected === failure) expect(thrown).toBe(failure);
    else {
      expect(thrown).toBeInstanceOf(failure.expected.constructor);
      expect(thrown.message).toBe(failure.expected.message);
    }
    expect(session.isActive()).toBe(false);
    expect(session.getTargets()).toBe(empty);
    expect(Object.isFrozen(session.getTargets())).toBe(true);
    expect(state.options.onError).not.toHaveBeenCalled();
    expect(() => session.start()).not.toThrow();
    expect(session.isActive()).toBe(true);
    session.stop();
  });
});

describe('account target session stale generations and rescanning', () => {
  it('ignores old settings, mutations, lookup completion, and lookup rejection after restart', async () => {
    const document = new FakeDocument();
    const target = appendTimelineTarget(document, 'openai');
    const oldLookup = deferred();
    const currentLookup = deferred();
    const { options, listeners, fakeObservers } = dependencies();
    options.loadAboutAccountPayload
      .mockReturnValueOnce(oldLookup.promise)
      .mockReturnValueOnce(currentLookup.promise);
    const session = createXAccountTargetSession(document, options);
    session.start();
    const oldMutationCallback = fakeObservers.instances[0].callback;
    session.stop();
    session.start();
    listeners[1]({ country: { highlight: ['JP'] } });
    options.onError.mockClear();

    listeners[0]({ country: { hide: ['JP'] } });
    oldMutationCallback([{}]);
    oldLookup.reject(new Error('old private failure'));
    await settle();
    expect(options.onError).not.toHaveBeenCalled();
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);
    expect(findLocationBadge(target.name)).toBeNull();

    currentLookup.resolve(payload());
    await settle();
    expect(findLocationBadge(target.name)).not.toBeNull();
    expect(getAccountAction(target.article)).toBe('highlight');
  });

  it('rescans additions, removals, updates, reordering, and no-change snapshots', () => {
    const document = new FakeDocument();
    const first = appendTimelineTarget(document, 'openai');
    const second = appendTimelineTarget(document, 'anthropic');
    const { options } = dependencies();
    const session = createXAccountTargetSession(document, options);
    const initial = session.start();
    expect(initial.map((entry) => entry.accountContainer)).toEqual([first.article, second.article]);
    expect(session.rescan()).toBe(initial);

    document.children.reverse();
    const reordered = session.rescan();
    expect(reordered.map((entry) => entry.accountContainer)).toEqual([second.article, first.article]);
    first.link.setAttribute('href', '/sama');
    const updated = session.rescan();
    expect(updated.find((entry) => entry.accountContainer === first.article).identity.handle).toBe('sama');

    const third = appendTimelineTarget(document, 'github');
    expect(session.rescan().some((entry) => entry.accountContainer === third.article)).toBe(true);
    document.children.splice(document.children.indexOf(second.article), 1);
    second.article.parentNode = null;
    expect(session.rescan().some((entry) => entry.accountContainer === second.article)).toBe(false);
    expect(session.rescan()).toBe(session.getTargets());
  });

  it('leaves manual scan failures governed by the observer', () => {
    const document = new FakeDocument();
    const { options } = dependencies();
    const session = createXAccountTargetSession(document, options);
    session.start();
    const failure = new Error('scan boundary failure');
    document.querySelectorAll = () => { throw failure; };
    expect(() => session.rescan()).toThrow(failure);
    expect(session.isActive()).toBe(true);
  });
});

describe('account target session roots and forwarding', () => {
  it('accepts document, element, disconnected, and cross-document-like roots', () => {
    const roots = [new FakeDocument()];
    const owner = new FakeDocument();
    roots.push(owner.createElement('section'));
    const otherDocument = new FakeDocument();
    roots.push(otherDocument.createElement('main'));
    roots.push({ querySelectorAll: () => [] });
    for (const root of roots) {
      const { options } = dependencies();
      const session = createXAccountTargetSession(root, options);
      expect(session.start()).toEqual([]);
      session.stop();
    }
  });

  it('preserves omitted, explicit, and explicitly undefined base URL behavior', () => {
    const omittedDocument = new FakeDocument();
    appendTimelineTarget(omittedDocument, 'openai');
    const omitted = dependencies();
    expect(createXAccountTargetSession(omittedDocument, omitted.options).start()).toHaveLength(1);

    const explicitDocument = new FakeDocument();
    appendTimelineTarget(explicitDocument, 'openai');
    const explicit = dependencies({ baseUrl: 'https://twitter.com/home' });
    expect(createXAccountTargetSession(explicitDocument, explicit.options)
      .start()[0].identity.profileUrl).toBe('https://x.com/openai');

    const undefinedDocument = new FakeDocument();
    appendTimelineTarget(undefinedDocument, 'openai');
    const explicitUndefined = dependencies({ baseUrl: undefined });
    expect(createXAccountTargetSession(undefinedDocument, explicitUndefined.options).start())
      .toEqual([]);
  });

  it('accepts frozen and facade runtimes without taking lifecycle ownership', () => {
    for (const runtime of [
      Object.freeze({ getSettings: () => ({}), subscribe: () => () => {} }),
      Object.create({ getSettings: () => ({}), subscribe: () => () => {} }),
    ]) {
      const { options } = dependencies({ settingsRuntime: runtime });
      const session = createXAccountTargetSession(new FakeDocument(), options);
      expect(session.start()).toEqual([]);
      session.stop();
    }
  });

  it('ignores inherited source, base URL, and account ID on a plain options object', () => {
    Object.defineProperties(Object.prototype, {
      source: { configurable: true, value: 'profile' },
      baseUrl: { configurable: true, value: 'https://example.invalid/' },
      accountId: { configurable: true, value: 'private' },
    });
    try {
      const { options } = dependencies();
      expect(() => createXAccountTargetSession(
        new FakeDocument(), { ...options, source: undefined },
      )).toThrow(new TypeError('Invalid account target session source'));
      const session = createXAccountTargetSession(new FakeDocument(), options);
      expect(session.start()).toEqual([]);
      session.stop();
    } finally {
      delete Object.prototype.source;
      delete Object.prototype.baseUrl;
      delete Object.prototype.accountId;
    }
  });

  it('keeps the session absent from live startup and prohibited platform boundaries', async () => {
    const sessionSource = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/content/account-target-session.js', import.meta.url), 'utf8',
    ));
    const contentSource = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/content/content-script.js', import.meta.url), 'utf8',
    ));
    const initializerSource = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/content/initialize-content-settings.js', import.meta.url), 'utf8',
    ));
    expect(contentSource).not.toContain('account-target-session');
    expect(initializerSource).not.toContain('account-target-session');
    expect(sessionSource).not.toMatch(/fetch|XMLHttpRequest|runtime\.sendMessage|MutationObserver/);
    expect(sessionSource).not.toMatch(/AbortController|setTimeout|setInterval|addEventListener/);
    expect(sessionSource).not.toMatch(/\b(?:Map|Set|WeakMap)\b/);
  });
});
