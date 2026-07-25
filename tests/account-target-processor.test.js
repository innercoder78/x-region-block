import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_PROCESSOR_VERSION,
  createXAccountTargetProcessor,
} from '../src/content/account-target-processor.js';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { FakeDocument } from './helpers/fake-dom.js';

const payload = (location = 'Japan') => ({
  data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: location } } } },
});

function target(handle = 'openai', source = 'timeline') {
  const document = new FakeDocument();
  const accountContainer = document.createElement('article');
  const badgeContainer = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  return Object.freeze({
    version: 1,
    source,
    accountContainer,
    link,
    badgeContainer,
    identity: createAccountIdentity({ handle, source }),
  });
}

function change(current, reason = 'initial') {
  return Object.freeze({
    version: 1,
    reason,
    source: 'timeline',
    current: Object.freeze(current),
    added: Object.freeze([]),
    updated: Object.freeze([]),
    removed: Object.freeze([]),
  });
}

function copyTarget(original, overrides = {}) {
  return Object.freeze({
    version: original.version,
    source: original.source,
    accountContainer: original.accountContainer,
    link: original.link,
    badgeContainer: original.badgeContainer,
    identity: original.identity,
    ...overrides,
  });
}

function copyIdentity(original, overrides = {}) {
  return Object.freeze({
    handle: original.handle,
    displayHandle: original.displayHandle,
    profileUrl: original.profileUrl,
    accountId: original.accountId,
    allowlistKey: original.allowlistKey,
    source: original.source,
    ...overrides,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const controllers = [];
  const options = {
    source: 'timeline',
    settings: {},
    loadAboutAccountPayload: vi.fn(() => payload()),
    abortControllerFactory: vi.fn(() => {
      const controller = { signal: Object.freeze({}), abort: vi.fn() };
      controllers.push(controller);
      return controller;
    }),
    onError: vi.fn(),
    ...overrides,
  };
  return { processor: createXAccountTargetProcessor(options), options, controllers };
}

const settle = () => Promise.resolve().then(() => Promise.resolve());

describe('account target processor API', () => {
  it('exports version 1 and an exact frozen controller', () => {
    const { processor } = setup();
    expect(ACCOUNT_TARGET_PROCESSOR_VERSION).toBe(1);
    expect(Object.keys(processor)).toEqual([
      'start', 'stop', 'processChange', 'setSettings', 'getTargets', 'isActive',
    ]);
    expect(Object.isFrozen(processor)).toBe(true);
  });

  it('accepts null-prototype options and normalizes source and settings', () => {
    const base = setup().options;
    const options = Object.assign(Object.create(null), base, { source: ' TIMELINE ' });
    const processor = createXAccountTargetProcessor(options);
    expect(processor.setSettings(Object.freeze({}))).toEqual(normalizeSettings({}));
  });

  it.each([null, [], 1, 'x', () => {}, new (class Options {})()])(
    'rejects invalid options %s', (options) => {
      expect(() => createXAccountTargetProcessor(options))
        .toThrow('account target processor options must be a plain object');
    },
  );

  it('rejects own account IDs and missing injected boundaries', () => {
    expect(() => createXAccountTargetProcessor({ ...setup().options, accountId: '1' }))
      .toThrow('accountId is not supported by account target processing');
    for (const property of ['loadAboutAccountPayload', 'abortControllerFactory', 'onError']) {
      const options = { ...setup().options };
      delete options[property];
      expect(() => createXAccountTargetProcessor(options)).toThrow(TypeError);
    }
  });

  it('starts lazily and restarts with the shared empty snapshot', () => {
    const { processor, options } = setup();
    const initial = processor.getTargets();
    expect(processor.start()).toBe(initial);
    expect(processor.start()).toBe(initial);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    processor.stop();
    expect(processor.isActive()).toBe(false);
    expect(processor.start()).toBe(initial);
  });
});

describe('lookup, reconciliation, and races', () => {
  it('deduplicates a lookup and presents every same-account target', async () => {
    const first = target();
    const second = target();
    const { processor, options } = setup();
    processor.start();
    expect(processor.processChange(change([first, second]))).toEqual([first, second]);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    const [identity, context] = options.loadAboutAccountPayload.mock.calls[0];
    expect(identity).toBe(first.identity);
    expect(Object.keys(context)).toEqual(['version', 'signal']);
    expect(Object.isFrozen(context)).toBe(true);
    await settle();
    expect(first.badgeContainer.children).toHaveLength(1);
    expect(second.badgeContainer.children).toHaveLength(1);
  });

  it('joins pending and resolved entries without another lookup', async () => {
    const pending = deferred();
    const first = target();
    const second = target();
    const { processor, options } = setup({ loadAboutAccountPayload: vi.fn(() => pending.promise) });
    processor.start();
    processor.processChange(change([first]));
    processor.processChange(change([first, second], 'mutation'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    pending.resolve(payload('Canada'));
    await settle();
    const third = target();
    processor.processChange(change([first, second, third], 'manual'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    expect(third.badgeContainer.children).toHaveLength(1);
  });

  it('aborts only after the final target and starts fresh on reappearance', () => {
    const pending = deferred();
    const first = target();
    const second = target();
    const { processor, options, controllers } = setup({
      loadAboutAccountPayload: vi.fn(() => pending.promise),
    });
    processor.start();
    processor.processChange(change([first, second]));
    processor.processChange(change([second], 'mutation'));
    expect(controllers[0].abort).not.toHaveBeenCalled();
    processor.processChange(change([], 'mutation'));
    expect(controllers[0].abort).toHaveBeenCalledOnce();
    processor.processChange(change([target()], 'mutation'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);
  });

  it('rejects stale completion after removal, stop, and restart', async () => {
    const old = deferred();
    const first = target();
    const { processor } = setup({ loadAboutAccountPayload: vi.fn(() => old.promise) });
    processor.start();
    processor.processChange(change([first]));
    processor.stop();
    processor.start();
    old.resolve(payload());
    await settle();
    expect(first.badgeContainer.children).toHaveLength(0);
    expect(processor.getTargets()).toEqual([]);
  });

  it('guards against link drift before asynchronous presentation', async () => {
    const pending = deferred();
    const current = target();
    const { processor } = setup({ loadAboutAccountPayload: vi.fn(() => pending.promise) });
    processor.start();
    processor.processChange(change([current]));
    current.link.setAttribute('href', '/different');
    pending.resolve(payload());
    await settle();
    expect(current.badgeContainer.children).toHaveLength(0);
  });

  it('re-presents resolved accounts on settings changes without a lookup', async () => {
    const current = target();
    const { processor, options } = setup();
    processor.start();
    processor.processChange(change([current]));
    await settle();
    const oldBadge = current.badgeContainer.children[0];
    const canonical = processor.setSettings({ country: { hide: ['jp'] } });
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    expect(current.badgeContainer.children[0]).toBe(oldBadge);
    expect(current.badgeContainer.children).toHaveLength(1);
  });

  it('reports generic load and parse errors while keeping targets presentable', async () => {
    const errors = [];
    const current = target();
    const { processor } = setup({
      loadAboutAccountPayload: vi.fn(() => Promise.reject(new Error('secret'))),
      onError: (error) => errors.push(error.message),
    });
    processor.start();
    processor.processChange(change([current]));
    await settle();
    expect(errors).toEqual(['Unable to load account location']);
    expect(current.badgeContainer.textContent).toContain('unavailable');
  });

  it('validates atomically and rejects duplicate containers', () => {
    const current = target();
    const { processor, options } = setup();
    processor.start();
    const before = processor.getTargets();
    expect(() => processor.processChange(change([current, current])))
      .toThrow('Invalid account target change');
    expect(processor.getTargets()).toBe(before);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
  });

  it.each([
    ['handle/allowlist disagreement', (value) => copyTarget(value, {
      identity: copyIdentity(value.identity, { handle: 'different' }),
    })],
    ['display handle disagreement', (value) => copyTarget(value, {
      identity: copyIdentity(value.identity, { displayHandle: '@different' }),
    })],
    ['profile URL disagreement', (value) => copyTarget(value, {
      identity: copyIdentity(value.identity, { profileUrl: 'https://x.com/different' }),
    })],
    ['invalid account ID', (value) => copyTarget(value, {
      identity: copyIdentity(value.identity, { accountId: 'sensitive-id' }),
    })],
    ['identity source disagreement', (value) => copyTarget(value, {
      identity: copyIdentity(value.identity, { source: 'profile' }),
    })],
    ['missing identity field', (value) => {
      const identity = { ...value.identity };
      delete identity.profileUrl;
      return copyTarget(value, { identity });
    }],
    ['sensitive identity property', (value) => copyTarget(value, {
      identity: { ...value.identity, token: 'secret' },
    })],
    ['sensitive target property', (value) => ({ ...value, cookie: 'secret' })],
    ['class target', (value) => Object.assign(new (class Target {})(), value)],
    ['class identity', (value) => copyTarget(value, {
      identity: Object.assign(new (class Identity {})(), value.identity),
    })],
    ['invalid link', (value) => copyTarget(value, { link: {} })],
    ['invalid badge container', (value) => copyTarget(value, { badgeContainer: {} })],
  ])('rejects malformed %s atomically', async (_name, malformed) => {
    const pending = deferred();
    const existing = target('existing');
    const waiting = target('waiting');
    const { processor, options, controllers } = setup({
      loadAboutAccountPayload: vi.fn()
        .mockReturnValueOnce(payload())
        .mockReturnValueOnce(pending.promise),
    });
    processor.start();
    processor.processChange(change([existing, waiting]));
    await settle();
    const settings = processor.setSettings({ country: { highlight: ['jp'] } });
    const beforeTargets = processor.getTargets();
    const beforeBadge = existing.badgeContainer.children[0] ?? null;
    options.loadAboutAccountPayload.mockClear();

    expect(() => processor.processChange(change([malformed(target())], 'mutation')))
      .toThrowError(new TypeError('Invalid account target change'));
    expect(processor.getTargets()).toBe(beforeTargets);
    expect(processor.setSettings(settings)).toEqual(settings);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    expect(controllers[1].abort).not.toHaveBeenCalled();
    expect(existing.badgeContainer.children[0] ?? null).toBe(beforeBadge);
    expect(options.onError).not.toHaveBeenCalled();
    pending.resolve(payload());
    await settle();
  });

  it('rejects class changes and malformed updated pairs atomically', () => {
    const current = target();
    const { processor, options } = setup();
    processor.start();
    const classChange = Object.assign(new (class Change {})(), change([]));
    expect(() => processor.processChange(classChange))
      .toThrowError(new TypeError('Invalid account target change'));
    const malformed = { ...change([]), updated: [{ previous: current, current, token: 'secret' }] };
    expect(() => processor.processChange(malformed))
      .toThrowError(new TypeError('Invalid account target change'));
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('never loads an inconsistent identity for a different account link', () => {
    const openai = target('openai');
    const malformed = copyTarget(openai, {
      identity: copyIdentity(openai.identity, { handle: 'different' }),
    });
    const { processor, options } = setup();
    processor.start();
    expect(() => processor.processChange(change([malformed])))
      .toThrowError(new TypeError('Invalid account target change'));
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    expect(openai.badgeContainer.children).toHaveLength(0);
  });
});

describe('additional asynchronous boundary coverage', () => {
  it('starts independent lookups and replaces account A with account B', () => {
    const pending = [];
    const first = target('first');
    const second = target('second');
    const { processor, options, controllers } = setup({
      loadAboutAccountPayload: vi.fn(() => {
        const value = deferred();
        pending.push(value);
        return value.promise;
      }),
    });
    processor.start();
    processor.processChange(change([first, second]));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);
    const replacement = copyTarget(target('third'), { accountContainer: first.accountContainer });
    processor.processChange(change([replacement, second], 'mutation'));
    expect(controllers[0].abort).toHaveBeenCalledOnce();
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(3);
  });

  it('ignores an old completion after recreating the same account entry', async () => {
    const old = deferred();
    const fresh = deferred();
    const loader = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const first = target();
    const { processor } = setup({ loadAboutAccountPayload: loader });
    processor.start();
    processor.processChange(change([first]));
    processor.processChange(change([], 'mutation'));
    const second = target();
    processor.processChange(change([second], 'mutation'));
    old.resolve(payload('Canada'));
    await settle();
    expect(second.badgeContainer.children).toHaveLength(0);
    fresh.resolve(payload('Japan'));
    await settle();
    expect(second.badgeContainer.textContent).toContain('Asia');
  });

  it.each([
    ['synchronous loader failure', { loader: () => { throw new Error('private'); } }],
    ['invalid abort controller', { controller: () => null }],
    ['parser top-level failure', { loader: () => null, error: 'Unable to parse account location' }],
  ])('isolates %s', async (_name, configured) => {
    const errors = [];
    const current = target();
    const { processor } = setup({
      loadAboutAccountPayload: vi.fn(configured.loader ?? (() => payload())),
      abortControllerFactory: vi.fn(configured.controller ?? (() => ({ signal: {}, abort: vi.fn() }))),
      onError: (error) => errors.push(error.message),
    });
    processor.start();
    expect(() => processor.processChange(change([current]))).not.toThrow();
    await settle();
    expect(errors).toEqual([configured.error ?? 'Unable to load account location']);
    expect(current.badgeContainer.textContent).toContain('unavailable');
  });

  it('isolates presentation and cleanup failures across targets', async () => {
    const pending = deferred();
    const first = target();
    const second = target();
    const errors = [];
    const { processor } = setup({
      loadAboutAccountPayload: vi.fn(() => pending.promise),
      onError: (error) => errors.push(error.message),
    });
    processor.start();
    processor.processChange(change([first, second]));
    first.badgeContainer.appendChild = () => { throw new Error('DOM detail'); };
    pending.resolve(payload());
    await settle();
    expect(second.badgeContainer.children).toHaveLength(1);
    expect(errors).toEqual(['Unable to present account location']);
    first.badgeContainer.removeChild = () => { throw new Error('DOM detail'); };
    second.badgeContainer.removeChild = () => { throw new Error('DOM detail'); };
    processor.processChange(change([], 'mutation'));
    expect(errors.filter((message) => message === 'Unable to remove account location badge'))
      .toHaveLength(1);
  });

  it('stops by aborting each pending lookup once and cleaning every badge', async () => {
    const resolved = target('resolved');
    const waiting = target('waiting');
    const pending = deferred();
    const loader = vi.fn().mockReturnValueOnce(payload()).mockReturnValueOnce(pending.promise);
    const { processor, controllers } = setup({ loadAboutAccountPayload: loader });
    processor.start();
    processor.processChange(change([resolved, waiting]));
    await settle();
    expect(resolved.badgeContainer.children).toHaveLength(1);
    processor.stop();
    expect(controllers[0].abort).not.toHaveBeenCalled();
    expect(controllers[1].abort).toHaveBeenCalledOnce();
    expect(resolved.badgeContainer.children).toHaveLength(0);
    processor.stop();
    expect(controllers[1].abort).toHaveBeenCalledOnce();
  });

  it('reorders and applies representative settings without repeated work', async () => {
    const first = target();
    const second = target();
    const { processor, options } = setup();
    processor.start();
    processor.processChange(change([first, second]));
    await settle();
    const badges = [first.badgeContainer.children[0], second.badgeContainer.children[0]];
    options.loadAboutAccountPayload.mockClear();
    processor.processChange(change([second, first], 'mutation'));
    expect(processor.getTargets()).toEqual([second, first]);
    expect(first.badgeContainer.children[0]).toBe(badges[0]);
    expect(second.badgeContainer.children[0]).toBe(badges[1]);
    for (const settings of [
      {},
      { country: { highlight: ['jp'] } },
      { country: { hide: ['jp'] } },
      { country: { hide: ['jp'], alwaysShow: ['jp'] } },
      { country: { hide: ['jp'] }, allowlist: ['@openai'] },
    ]) processor.setSettings(settings);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    expect(first.badgeContainer.children).toHaveLength(1);
  });

  it.each([
    ['known', payload('Japan'), 'Asia'],
    ['missing', payload(null), 'Location not provided'],
    ['unknown', payload('Atlantis'), 'Location unknown'],
    ['unavailable', {}, 'Location unavailable'],
    ['Antarctica', payload('Antarctica'), 'Unknown region'],
  ])('presents %s locations', async (_name, input, label) => {
    const current = target();
    const { processor } = setup({ loadAboutAccountPayload: vi.fn(() => input) });
    processor.start();
    processor.processChange(change([current]));
    await settle();
    expect(current.badgeContainer.textContent).toContain(label);
  });

  it('swallows error callback failures', async () => {
    const current = target();
    const { processor } = setup({
      loadAboutAccountPayload: vi.fn(() => Promise.reject(new Error('private'))),
      onError: () => { throw new Error('callback'); },
    });
    processor.start();
    processor.processChange(change([current]));
    await expect(settle()).resolves.toBeUndefined();
  });
});

describe('account action integration', () => {
  it('renders a badge and reverses highlight, hide, show, then cleans up without a new lookup', async () => {
    const current = target();
    const { processor, options } = setup({
      settings: { country: { highlight: ['jp'] } },
    });
    processor.start();
    processor.processChange(change([current]));
    await settle();

    expect(current.badgeContainer.textContent).toContain('Asia');
    expect(current.accountContainer.getAttribute('data-x-region-block-account-action'))
      .toBe('highlight');
    processor.setSettings({ country: { hide: ['jp'] } });
    expect(current.accountContainer.getAttribute('data-x-region-block-account-action')).toBe('hide');
    processor.setSettings({});
    expect(current.accountContainer.getAttribute('data-x-region-block-account-action')).toBeNull();
    processor.processChange(change([], 'mutation'));
    expect(current.badgeContainer.children).toHaveLength(0);
    expect(current.accountContainer.getAttribute('data-x-region-block-account-action')).toBeNull();
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
  });
});
