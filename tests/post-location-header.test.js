import { describe, expect, it, vi } from 'vitest';
import { FakeDocument } from './helpers/fake-dom.js';
import { reconcilePostLocationHeader, removePostLocationHeader } from '../src/content/post-location-header.js';
import { renderLocationBadge } from '../src/content/location-badge-renderer.js';

describe('tweet location header', () => {
  it('is a unique sibling immediately before the local author line and renders required formats', () => {
    const document = new FakeDocument(); const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet'); const column = document.createElement('div');
    const pinned = document.createElement('div'); pinned.textContent = 'Pinned';
    const name = document.createElement('div'); name.setAttribute('data-testid', 'User-Name');
    column.appendChild(pinned); column.appendChild(name); article.appendChild(column);
    const target = { source: 'timeline', accountContainer: article, badgeContainer: name };
    const header = reconcilePostLocationHeader(target);
    expect(column.children).toEqual([pinned, header, name]);
    expect(reconcilePostLocationHeader(target)).toBe(header);
    const resolver = vi.fn(() => 'chrome-extension://test/assets/flags/us.png');
    const badge = renderLocationBadge(header, { status: 'known', countryCode: 'US',
      countryName: 'United States', regionCode: 'NORTH_AMERICA', regionName: 'North America',
      rawLocation: 'United States', source: 'x-about-account' }, resolver, { postHeader: true });
    expect(badge.textContent).toBe('Country:');
    expect(badge.getAttribute('aria-label')).toBe('Country: United States');
    badge.children[0].children[0].dispatchEvent({ type: 'error' });
    expect(badge.textContent).toBe('Country: US');
    renderLocationBadge(header, { status: 'unknown' }, resolver, { postHeader: true });
    expect(header.textContent).toBe('Location: Unknown');
    expect(removePostLocationHeader(target)).toBe(1);
  });
});
