import { describe, expect, it, vi } from 'vitest';
import { FakeDocument } from './helpers/fake-dom.js';
import { createXSidebarNavigation } from '../src/content/sidebar-navigation.js';

function componentFixture(testId, nested = false, openOptions = vi.fn()) {
  const document = new FakeDocument(); const nav = document.createElement('nav');
  const control = document.createElement('a'); control.setAttribute('data-testid', testId);
  const entry = nested ? document.createElement('div') : control;
  if (nested) entry.appendChild(control); nav.appendChild(entry); document.appendChild(nav);
  let callback; const observer = { observe: vi.fn(), disconnect: vi.fn() };
  const component = createXSidebarNavigation(document, {
    openOptions, observerFactory: (value) => { callback = value; return observer; },
  });
  return { document, nav, entry, control, component, observer, openOptions, mutate: () => callback([]) };
}

describe('Region Blocker sidebar navigation', () => {
  it.each([[false, 'direct'], [true, 'wrapped']])('inserts before a %s More navigation entry', (nested) => {
    const fixture = componentFixture('AppTabBar_More_Menu', nested); const item = fixture.component.start();
    expect(fixture.nav.children).toEqual([item, fixture.entry]);
    expect(item.parentElement).toBe(fixture.nav); expect(fixture.control.children).not.toContain(item);
    expect(item.tagName).toBe('BUTTON'); expect(item.getAttribute('type')).toBe('button');
    expect(item.textContent).toBe('Region Blocker'); expect(item.getAttribute('aria-label')).toBe('Open Region Blocker options');
  });

  it.each([['AppTabBar_Profile_Link'], ['AppTabBar_Home_Link']])('falls back after %s', (testId) => {
    const fixture = componentFixture(testId, true); const item = fixture.component.start();
    expect(fixture.nav.children).toEqual([fixture.entry, item]);
  });

  it('activates click, Enter, and Space only and contains rejected or missing APIs', async () => {
    const open = vi.fn(() => Promise.reject(new Error('contained')));
    const fixture = componentFixture('AppTabBar_More_Menu', false, open); const item = fixture.component.start();
    item.dispatchEvent({ type: 'click' }); item.dispatchEvent({ type: 'keydown', key: 'Enter' });
    item.dispatchEvent({ type: 'keydown', key: ' ' }); item.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(open).toHaveBeenCalledTimes(3); await Promise.resolve();
    const missing = componentFixture('AppTabBar_More_Menu', false, undefined); const missingItem = missing.component.start();
    expect(() => missingItem.dispatchEvent({ type: 'click' })).not.toThrow();
  });

  it('recreates a removed item and completely stops observation and listeners', () => {
    const fixture = componentFixture('AppTabBar_More_Menu'); const first = fixture.component.start();
    fixture.nav.removeChild(first); fixture.mutate(); const current = fixture.nav.children[0];
    expect(current).not.toBe(first); expect(fixture.nav.children).toEqual([current, fixture.entry]);
    fixture.component.stop(); expect(fixture.nav.children).toEqual([fixture.entry]);
    expect(fixture.observer.disconnect).toHaveBeenCalledOnce(); fixture.mutate();
    expect(fixture.nav.children).toEqual([fixture.entry]);
  });
});
