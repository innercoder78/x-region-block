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

  it('keeps retained wrappers safe but silent behind newer page wrappers after stop', () => {
    const global = facade();
    const controller = installXNavigationSignal(global);
    const extensionPush = global.history.pushState;
    const extensionReplace = global.history.replaceState;
    global.history.pushState = function (...args) {
      return Reflect.apply(extensionPush, this, args);
    };
    global.history.replaceState = function (...args) {
      return Reflect.apply(extensionReplace, this, args);
    };
    const pagePush = global.history.pushState;
    const pageReplace = global.history.replaceState;
    controller.stop();
    expect(global.history.pushState).toBe(pagePush);
    expect(global.history.replaceState).toBe(pageReplace);
    expect(global.history.pushState('a', 'b')).toEqual({
      receiver: global.history, args: ['a', 'b'],
    });
    expect(global.history.replaceState('c')).toEqual({ receiver: global.history, args: ['c'] });
    expect(global.events).toHaveLength(0);
  });

  it('retained wrappers preserve original exceptions after stop', () => {
    const failure = new Error('original');
    const global = facade();
    global.history.pushState = () => { throw failure; };
    const controller = installXNavigationSignal(global);
    const retained = global.history.pushState;
    global.history.pushState = function (...args) { return Reflect.apply(retained, this, args); };
    controller.stop();
    expect(() => global.history.pushState('state')).toThrow(failure);
    expect(global.events).toHaveLength(0);
  });

  it.each(['pushState', 'replaceState'])(
    'transactionally rolls back when %s assignment readback throws',
    (failingProperty) => {
      const global = facade();
      const originals = {
        pushState: global.history.pushState,
        replaceState: global.history.replaceState,
      };
      const values = { ...originals };
      let assignedWrapper = false;
      let throwRead = false;
      let originalWrites = 0;
      let failureEnabled = true;
      for (const property of ['pushState', 'replaceState']) {
        Object.defineProperty(global.history, property, {
          configurable: true,
          get() {
            if (property === failingProperty && throwRead) throw new Error('readback');
            return values[property];
          },
          set(value) {
            values[property] = value;
            if (value !== originals[property]) {
              assignedWrapper = true;
              if (property === failingProperty && failureEnabled) throwRead = true;
            } else if (property === failingProperty) {
              originalWrites += 1;
            }
          },
        });
      }
      expect(() => installXNavigationSignal(global)).toThrowError(
        new Error('Unable to install X navigation signal'),
      );
      expect(assignedWrapper).toBe(true);
      expect(originalWrites).toBe(0);
      expect(() => global.history[failingProperty]).toThrowError(new Error('readback'));
      expect(Reflect.apply(values[failingProperty], global.history, ['safe'])).toEqual({
        receiver: global.history, args: ['safe'],
      });
      expect(global.events).toHaveLength(0);
      failureEnabled = false;
      throwRead = false;
      values[failingProperty] = originals[failingProperty];
      expect(installXNavigationSignal(global).isActive()).toBe(true);
    },
  );

  it('rolls back when a setter ignores an assigned wrapper', () => {
    const global = facade();
    const original = global.history.pushState;
    Object.defineProperty(global.history, 'pushState', {
      configurable: true, get: () => original, set: () => {},
    });
    expect(() => installXNavigationSignal(global)).toThrowError(
      new Error('Unable to install X navigation signal'),
    );
    expect(global.history.pushState).toBe(original);
  });

  it.each(['pushState', 'replaceState'])(
    'does not write an unverifiable page-owned %s accessor during stop',
    (property) => {
      const global = facade();
      const other = property === 'pushState' ? 'replaceState' : 'pushState';
      const originalOther = global.history[other];
      const controller = installXNavigationSignal(global);
      const retained = global.history[property];
      let writes = 0;
      Object.defineProperty(global.history, property, {
        configurable: true,
        get() { throw new Error('page getter'); },
        set() { writes += 1; },
      });
      controller.stop();
      expect(writes).toBe(0);
      expect(() => global.history[property]).toThrowError(new Error('page getter'));
      expect(global.history[other]).toBe(originalOther);
      expect(Reflect.apply(retained, global.history, ['state', 'title'])).toEqual({
        receiver: global.history, args: ['state', 'title'],
      });
      expect(global.events).toHaveLength(0);
    },
  );

  it('continues rollback when the second assignment and first restoration fail', () => {
    const global = facade();
    const originalPush = global.history.pushState;
    const originalReplace = global.history.replaceState;
    let pushValue = originalPush;
    Object.defineProperty(global.history, 'pushState', {
      configurable: true,
      get: () => pushValue,
      set(value) {
        if (value === originalPush) throw new Error('restore');
        pushValue = value;
      },
    });
    Object.defineProperty(global.history, 'replaceState', {
      configurable: true,
      get: () => originalReplace,
      set() { throw new Error('install'); },
    });
    expect(() => installXNavigationSignal(global)).toThrowError(
      new Error('Unable to install X navigation signal'),
    );
    expect(Reflect.apply(pushValue, global.history, ['safe'])).toEqual({
      receiver: global.history, args: ['safe'],
    });
    expect(global.events).toHaveLength(0);
  });
});
