import { describe, expect, it, vi } from 'vitest';
import { FakeDocument } from './helpers/fake-dom.js';
import { createXSidebarNavigation } from '../src/content/sidebar-navigation.js';

describe('Region Blocker sidebar navigation', () => {
  it('inserts before More, activates by direct gestures, and cleans up', async () => {
    const document = new FakeDocument(); const nav = document.createElement('nav');
    const more = document.createElement('a'); more.setAttribute('data-testid', 'AppTabBar_More_Menu');
    nav.appendChild(more); document.appendChild(nav);
    const openOptionsPage = vi.fn(() => Promise.resolve());
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const component = createXSidebarNavigation(document, {
      extensionApi: { runtime: { openOptionsPage } }, observerFactory: () => observer,
    });
    const item = component.start();
    expect(nav.children).toEqual([item, more]);
    expect(item.textContent).toBe('Region Blocker');
    expect(item.getAttribute('aria-label')).toBe('Open Region Blocker options');
    item.dispatchEvent({ type: 'click' });
    item.dispatchEvent({ type: 'keydown', key: 'Enter' });
    item.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(openOptionsPage).toHaveBeenCalledTimes(2);
    component.stop();
    expect(nav.children).toEqual([more]); expect(observer.disconnect).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
});
