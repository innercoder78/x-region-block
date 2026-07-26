import { describe, expect, it, vi } from 'vitest';
import {
  X_NAVIGATION_SIGNAL_VERSION, installXNavigationSignal,
} from '../src/page/x-navigation-signal.js';
import { X_NAVIGATION_EVENT_TYPE } from '../src/shared/x-navigation-event.js';

function facade() {
  const events = [];
  class Event { constructor(type) { this.type = type; } }
  const history = {
    pushState(...args) { return { receiver: this, args }; },
    replaceState(...args) { return { receiver: this, args }; },
  };
  return { history, document: { dispatchEvent: (event) => events.push(event) }, Event, events };
}

describe('X navigation signal', () => {
  it('exposes version 1 and an exact frozen lifecycle API', () => {
    const global = facade();
    const controller = installXNavigationSignal(global);
    expect(X_NAVIGATION_SIGNAL_VERSION).toBe(1);
    expect(Object.keys(controller)).toEqual(['stop', 'isActive']);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(installXNavigationSignal(global)).toBe(controller);
  });

  it('forwards calls and emits one no-detail event only after success', () => {
    const global = facade();
    const original = global.history.pushState;
    const controller = installXNavigationSignal(global);
    const result = global.history.pushState('state', 'title', '/path');
    expect(result).toEqual({ receiver: global.history, args: ['state', 'title', '/path'] });
    expect(global.events).toHaveLength(1);
    expect(global.events[0]).toEqual({ type: X_NAVIGATION_EVENT_TYPE });
    expect('detail' in global.events[0]).toBe(false);
    controller.stop();
    expect(global.history.pushState).toBe(original);
    expect(controller.isActive()).toBe(false);
  });

  it('preserves original failures and swallows dispatch failures', () => {
    const failure = new Error('page failure');
    const global = facade();
    global.history.pushState = () => { throw failure; };
    installXNavigationSignal(global);
    expect(() => global.history.pushState()).toThrow(failure);
    expect(global.events).toHaveLength(0);
    global.document.dispatchEvent = vi.fn(() => { throw new Error('signal failure'); });
    expect(global.history.replaceState()).toEqual({ receiver: global.history, args: [] });
  });

  it('validates facades and does not overwrite a later page wrapper', () => {
    expect(() => installXNavigationSignal({})).toThrowError(
      new TypeError('Invalid X navigation signal global scope'),
    );
    const global = facade();
    const controller = installXNavigationSignal(global);
    const pageMethod = () => 'page';
    global.history.pushState = pageMethod;
    controller.stop();
    expect(global.history.pushState).toBe(pageMethod);
    expect(installXNavigationSignal(global)).not.toBe(controller);
  });
});
