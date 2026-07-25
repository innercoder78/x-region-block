import { describe, expect, it } from 'vitest';
import { FakeDocument, snapshot } from './helpers/fake-dom.js';
import { FILTER_ACTIONS } from '../src/shared/filter-engine.js';
import {
  ACCOUNT_ACTION_ATTRIBUTE,
  ACCOUNT_ACTION_RENDERER_VERSION,
  applyAccountAction,
  getAccountAction,
  removeAccountAction,
} from '../src/content/account-action-renderer.js';

const invalidContainers = [undefined, null, 1, 'div', [], {}, { getAttribute() {} }];

describe('account action renderer', () => {
  it('exports its version and exact ownership attribute', () => {
    expect(ACCOUNT_ACTION_RENDERER_VERSION).toBe(1);
    expect(ACCOUNT_ACTION_ATTRIBUTE).toBe('data-x-region-block-account-action');
  });

  it.each(invalidContainers)('rejects an invalid container without mutation', (container) => {
    expect(() => getAccountAction(container)).toThrow(new TypeError('Invalid account action container'));
    expect(() => removeAccountAction(container)).toThrow(new TypeError('Invalid account action container'));
    expect(() => applyAccountAction(container, FILTER_ACTIONS.HIDE))
      .toThrow(new TypeError('Invalid account action container'));
  });

  it.each([undefined, null, 'SHOW', ' show', 'hide ', {}, [], 1, 'unknown'])(
    'rejects invalid exact actions before mutation', (action) => {
      const element = new FakeDocument().createElement('div');
      expect(() => applyAccountAction(element, action)).toThrow(new TypeError('Invalid account filter action'));
      expect(element.attributes.size).toBe(0);
    },
  );

  it('supports every reversible and idempotent transition without touching other content', () => {
    const document = new FakeDocument();
    const element = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'X content';
    element.appendChild(child);
    element.setAttribute('class', 'x-owned');
    element.setAttribute('style', 'color: red');
    const beforeChild = snapshot(child);

    expect(applyAccountAction(element, FILTER_ACTIONS.SHOW)).toBe('show');
    expect(getAccountAction(element)).toBe('show');
    for (const action of ['highlight', 'hide', 'highlight', 'show', 'hide', 'show']) {
      expect(applyAccountAction(element, action)).toBe(action);
      expect(getAccountAction(element)).toBe(action);
    }
    applyAccountAction(element, 'highlight');
    applyAccountAction(element, 'highlight');
    expect(element.getAttribute(ACCOUNT_ACTION_ATTRIBUTE)).toBe('highlight');
    expect(element.getAttribute('class')).toBe('x-owned');
    expect(element.getAttribute('style')).toBe('color: red');
    for (const name of ['hidden', 'inert', 'aria-hidden', 'tabindex']) expect(element.getAttribute(name)).toBeNull();
    expect(snapshot(child)).toEqual(beforeChild);
    expect(document.created).toEqual([element, child]);
  });

  it('accepts connected, disconnected, cross-document, frozen, and non-extensible facades', () => {
    for (const document of [new FakeDocument(), new FakeDocument()]) {
      const element = document.createElement('div');
      if (document.children.length === 0) document.appendChild(element);
      expect(applyAccountAction(element, 'hide')).toBe('hide');
    }
    const attributes = new Map();
    const facade = Object.freeze({
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
    });
    expect(applyAccountAction(facade, 'highlight')).toBe('highlight');
    expect(getAccountAction(facade)).toBe('highlight');
  });

  it.each([null, '', 'other'])('preserves unowned markers while reporting show', (marker) => {
    const element = new FakeDocument().createElement('div');
    if (marker !== null) element.setAttribute(ACCOUNT_ACTION_ATTRIBUTE, marker);
    expect(getAccountAction(element)).toBe('show');
    expect(removeAccountAction(element)).toBe(0);
    expect(applyAccountAction(element, 'show')).toBe('show');
    expect(element.getAttribute(ACCOUNT_ACTION_ATTRIBUTE)).toBe(marker);
  });

  it('removes only recognized owned values and returns its mutation count', () => {
    const element = new FakeDocument().createElement('div');
    for (const action of ['highlight', 'hide']) {
      element.setAttribute(ACCOUNT_ACTION_ATTRIBUTE, action);
      expect(removeAccountAction(element)).toBe(1);
      expect(removeAccountAction(element)).toBe(0);
    }
  });
});
