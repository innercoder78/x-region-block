import { describe, expect, it, vi } from 'vitest';
import { X_PAGE_RUNTIME_READY_EVENT_TYPE } from '../src/shared/x-page-runtime-event.js';
import { X_PAGE_SCRIPT_INJECTOR_VERSION, createXPageScriptInjector } from '../src/content/x-page-script-injector.js';

function scope(runtimeName = 'browser') {
  const document = new EventTarget();
  const scripts = [];
  const observers = [];
  document.createElement = () => ({ remove: vi.fn(), onload: null, onerror: null });
  document.documentElement = {
    appendChild(script) { scripts.push(script); },
  };
  const runtime = { getURL: vi.fn((path) => `moz-extension://id/${path}`) };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observers.push(this); }
    observe() { this.observing = true; }
  }
  const value = {
    location: { origin: 'https://x.com' }, document, Event, Promise, MutationObserver,
  };
  value[runtimeName] = { runtime };
  return { value, runtime, scripts, observers, document };
}

describe('X page script injector', () => {
  it('uses browser getURL and resolves after a ready event', async () => {
    const fake = scope();
    const injector = createXPageScriptInjector(fake.value);
    const started = injector.start();
    expect(X_PAGE_SCRIPT_INJECTOR_VERSION).toBe(1);
    expect(fake.runtime.getURL).toHaveBeenCalledWith('page/page-script.js');
    expect(fake.scripts[0].src).toBe('moz-extension://id/page/page-script.js');
    expect(fake.scripts[0].async).toBe(false);
    fake.document.dispatchEvent(new Event(X_PAGE_RUNTIME_READY_EVENT_TYPE));
    await expect(started).resolves.toBeUndefined();
    expect(injector.isActive()).toBe(true);
    expect(fake.scripts[0].remove).toHaveBeenCalledOnce();
    injector.stop();
  });

  it('falls back to chrome and rejects load without readiness in a microtask', async () => {
    const fake = scope('chrome');
    fake.runtime.getURL = vi.fn((path) => `chrome-extension://id/${path}`);
    const injector = createXPageScriptInjector(fake.value);
    const started = injector.start();
    fake.scripts[0].onload();
    await expect(started).rejects.toThrow('Unable to inject X page runtime');
    expect(fake.runtime.getURL).toHaveBeenCalledWith('page/page-script.js');
  });

  it('detects an existing runtime without inserting a script', async () => {
    const fake = scope();
    fake.document.addEventListener('x-region-block:page-runtime-request', () => {
      fake.document.dispatchEvent(new Event(X_PAGE_RUNTIME_READY_EVENT_TYPE));
    });
    const injector = createXPageScriptInjector(fake.value);
    await injector.start();
    expect(fake.scripts).toHaveLength(0);
    expect(fake.runtime.getURL).not.toHaveBeenCalled();
  });

  it('rejects and cannot revive after stop during a pending load', async () => {
    const fake = scope();
    const injector = createXPageScriptInjector(fake.value);
    const started = injector.start();
    const script = fake.scripts[0];
    injector.stop();
    await expect(started).rejects.toThrow('Unable to inject X page runtime');
    fake.document.dispatchEvent(new Event(X_PAGE_RUNTIME_READY_EVENT_TYPE));
    script.onload?.();
    expect(injector.isActive()).toBe(false);
  });

  it('waits without a timer when documentElement is initially unavailable', async () => {
    const fake = scope();
    fake.document.documentElement = null;
    const injector = createXPageScriptInjector(fake.value);
    const first = injector.start();
    expect(injector.start()).toBe(first);
    expect(fake.scripts).toHaveLength(0);
    fake.document.documentElement = { appendChild(script) { fake.scripts.push(script); } };
    fake.observers[0].callback([]);
    expect(fake.observers[0].disconnect).toHaveBeenCalled();
    fake.document.dispatchEvent(new Event(X_PAGE_RUNTIME_READY_EVENT_TYPE));
    await first;
    injector.stop();
  });

  it('disconnects and never inserts when stopped before documentElement exists', async () => {
    const fake = scope(); fake.document.documentElement = null;
    const injector = createXPageScriptInjector(fake.value);
    const started = injector.start(); const observer = fake.observers[0];
    injector.stop();
    await expect(started).rejects.toThrow('Unable to inject X page runtime');
    fake.document.documentElement = { appendChild(script) { fake.scripts.push(script); } };
    observer.callback([]);
    expect(observer.disconnect).toHaveBeenCalled();
    expect(fake.scripts).toHaveLength(0);
  });

  it('owns startup before listener registration and supports retry after failure', async () => {
    const fake = scope();
    const originalAdd = fake.document.addEventListener.bind(fake.document);
    let injector; let first; let reentrant;
    let entered = false;
    fake.document.addEventListener = (...args) => {
      if (!entered) {
        entered = true;
        reentrant = injector.start();
        injector.stop();
      }
      return originalAdd(...args);
    };
    injector = createXPageScriptInjector(fake.value);
    first = injector.start();
    expect(reentrant).toBe(first);
    await expect(first).rejects.toThrow('Unable to inject X page runtime');
    fake.document.addEventListener = originalAdd;
    const retried = injector.start();
    fake.document.dispatchEvent(new Event(X_PAGE_RUNTIME_READY_EVENT_TYPE));
    await expect(retried).resolves.toBeUndefined();
    injector.stop();
  });
});
