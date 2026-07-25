import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_TARGET_OBSERVER_VERSION,
  createXAccountTargetObserver,
} from '../src/content/account-target-observer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function tweet(document, handle) {
  const surface = document.createElement('article');
  surface.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link);
  surface.appendChild(name);
  return { surface, name, link };
}

function setup(root, overrides = {}) {
  const fake = createFakeObserverFactory();
  const changes = [];
  const errors = [];
  const observer = createXAccountTargetObserver(root, {
    source: ' TIMELINE ', observerFactory: fake.factory,
    onChange: (change) => changes.push(change), onError: (error) => errors.push(error),
    ...overrides,
  });
  return { observer, fake, changes, errors };
}

const flush = () => Promise.resolve();

describe('account target observer API and validation', () => {
  it('has the exact frozen versioned controller API and starts lazily', () => {
    const document = new FakeDocument();
    const context = setup(document);
    expect(ACCOUNT_TARGET_OBSERVER_VERSION).toBe(1);
    expect(Object.keys(context.observer)).toEqual(['start', 'stop', 'rescan', 'getTargets', 'isActive']);
    expect(Object.isFrozen(context.observer)).toBe(true);
    expect(context.fake.instances).toHaveLength(0);
    expect(Object.isFrozen(context.observer.getTargets())).toBe(true);
  });

  it.each([null, [], {}, 1, 'root', () => {}])('rejects invalid root %j', (root) => {
    expect(() => setup(root)).toThrow('Invalid account target observer root');
  });

  it('accepts document, disconnected, cross-document roots and null-prototype options', () => {
    const first = new FakeDocument();
    const second = new FakeDocument();
    const root = first.createElement('div');
    root.appendChild(tweet(second, 'OpenAI').surface);
    const fake = createFakeObserverFactory();
    const options = Object.assign(Object.create(null), {
      source: ' Timeline ', observerFactory: fake.factory, onChange() {}, onError() {},
    });
    expect(createXAccountTargetObserver(root, options).start()).toHaveLength(1);
    expect(setup(first).observer.start()).toHaveLength(0);
  });

  it('validates plain options, own source, accountId, factory, and callbacks', () => {
    const root = { querySelectorAll: () => [] };
    const valid = { source: 'timeline', observerFactory() {}, onChange() {}, onError() {} };
    for (const options of [null, [], 1, () => {}, new (class Options {})()]) {
      expect(() => createXAccountTargetObserver(root, options)).toThrow('plain object');
    }
    expect(() => createXAccountTargetObserver(root, { ...valid, source: 'bad' })).toThrow('source');
    expect(() => createXAccountTargetObserver(root, { ...valid, accountId: undefined })).toThrow('accountId');
    expect(() => createXAccountTargetObserver(root, { ...valid, observerFactory: null })).toThrow('observerFactory');
    expect(() => createXAccountTargetObserver(root, { ...valid, onChange: null })).toThrow('onChange');
    expect(() => createXAccountTargetObserver(root, { ...valid, onError: null })).toThrow('onError');
  });
});

describe('account target observer lifecycle and reconciliation', () => {
  it('attaches exactly, performs one initial scan, and is idempotent', () => {
    const document = new FakeDocument();
    const item = tweet(document, 'OpenAI');
    document.appendChild(item.surface);
    const context = setup(document);
    const current = context.observer.start();
    expect(context.fake.instances[0].observations).toEqual([{ target: document, options: {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid', 'href'],
    } }]);
    expect(current).toBe(context.observer.start());
    expect(context.fake.instances).toHaveLength(1);
    expect(context.changes[0]).toMatchObject({ version: 1, reason: 'initial', source: 'timeline' });
    expect(context.changes[0].added).toEqual(current);
    expect(Object.isFrozen(context.changes[0])).toBe(true);
  });

  it('coalesces mutations, preserves stable records, reports update, reorder and removal', async () => {
    const document = new FakeDocument();
    const first = tweet(document, 'OpenAI');
    const second = tweet(document, 'GitHub');
    document.appendChild(first.surface);
    document.appendChild(second.surface);
    const context = setup(document);
    const initial = context.observer.start();
    document.children.reverse();
    context.fake.instances[0].trigger([{}, {}]);
    context.fake.instances[0].trigger([{}]);
    await flush();
    expect(context.changes).toHaveLength(2);
    expect(context.changes[1].current).toEqual([initial[1], initial[0]]);
    expect(context.changes[1].added).toEqual([]);
    expect(context.changes[1].updated).toEqual([]);
    first.link.setAttribute('href', '/Anthropic');
    context.fake.instances[0].trigger();
    await flush();
    expect(Object.keys(context.changes[2].updated[0])).toEqual(['previous', 'current']);
    expect(context.changes[2].updated[0].previous).toBe(initial[0]);
    document.children.splice(document.children.indexOf(first.surface), 1);
    first.surface.parentNode = null;
    context.fake.instances[0].trigger();
    await flush();
    expect(context.changes[3].removed[0]).toBe(context.changes[2].updated[0].current);
  });

  it('manual rescans are immediate, preserve no-change arrays, and reject inactivity', () => {
    const document = new FakeDocument();
    const context = setup(document);
    expect(() => context.observer.rescan()).toThrow('not active');
    const initial = context.observer.start();
    expect(context.observer.rescan()).toBe(initial);
    document.appendChild(tweet(document, 'OpenAI').surface);
    expect(context.observer.rescan()).toHaveLength(1);
    expect(context.changes.at(-1).reason).toBe('manual');
  });

  it('invalidates pending work, disconnects once, clears targets, and restarts fresh', async () => {
    const document = new FakeDocument();
    const context = setup(document);
    context.observer.start();
    context.fake.instances[0].trigger();
    context.observer.stop();
    context.observer.stop();
    expect(context.fake.instances[0].disconnectCount).toBe(1);
    expect(context.observer.getTargets()).toEqual([]);
    await flush();
    expect(context.changes).toHaveLength(1);
    context.observer.start();
    expect(context.fake.instances).toHaveLength(2);
  });

  it('cleans up failed starts and isolates mutation and delivery errors', async () => {
    const root = { querySelectorAll: vi.fn(() => { throw new Error('private detail'); }) };
    const context = setup(root);
    expect(() => context.observer.start()).toThrow('private detail');
    expect(context.observer.isActive()).toBe(false);
    expect(context.fake.instances[0].disconnectCount).toBe(1);

    const document = new FakeDocument();
    const delivery = setup(document, { onChange: () => { throw new Error('secret'); } });
    delivery.observer.start();
    expect(delivery.errors[0]).toEqual(new Error('Unable to deliver account target changes'));
    document.querySelectorAll = () => { throw new Error('target secret'); };
    delivery.fake.instances[0].trigger();
    await flush();
    expect(delivery.errors[1]).toEqual(new Error('Unable to refresh account targets'));
    expect(delivery.observer.isActive()).toBe(true);
  });
});
