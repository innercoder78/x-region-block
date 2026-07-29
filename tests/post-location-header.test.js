import { describe, expect, it, vi } from 'vitest';
import { FakeDocument } from './helpers/fake-dom.js';
import { reconcilePostLocationHeader, removePostLocationHeader,
  resolvePostLocationHeaderHost } from '../src/content/post-location-header.js';
import { renderLocationBadge } from '../src/content/location-badge-renderer.js';

function tweet(document, parent = null) {
  const article = document.createElement('article'); article.setAttribute('data-testid', 'tweet');
  const shell = document.createElement('div'); const column = document.createElement('div');
  const pinned = document.createElement('div'); pinned.textContent = 'Pinned';
  const row = document.createElement('div'); const nameShell = document.createElement('div');
  const nameInner = document.createElement('div'); const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name'); name.textContent = 'Author · now';
  nameInner.appendChild(name); nameShell.appendChild(nameInner);
  const menu = document.createElement('button'); menu.setAttribute('data-testid', 'caret'); menu.textContent = 'Menu';
  const text = document.createElement('div'); text.setAttribute('data-testid', 'tweetText'); text.textContent = 'Post';
  const actions = document.createElement('div'); const reply = document.createElement('button');
  reply.setAttribute('data-testid', 'reply'); actions.appendChild(reply);
  row.appendChild(nameShell); row.appendChild(menu); column.appendChild(pinned); column.appendChild(row);
  column.appendChild(text); column.appendChild(actions);
  shell.appendChild(column); article.appendChild(shell); (parent ?? document).appendChild(article);
  return { article, shell, column, pinned, row, nameShell, nameInner, name, menu, text, actions,
    target: { source: 'timeline', accountContainer: article, badgeContainer: name } };
}

describe('tweet location header', () => {
  it('sits between Pinned and the complete horizontal author row', () => {
    const document = new FakeDocument(); const post = tweet(document);
    const header = reconcilePostLocationHeader(post.target);
    expect(resolvePostLocationHeaderHost(post.target)).toMatchObject({
      authorRow: post.row, contentColumn: post.column,
    });
    expect(post.column.children).toEqual([post.pinned, header, post.row, post.text, post.actions]);
    expect(header.parentElement).toBe(post.column); expect(post.row.children).toEqual([post.nameShell, post.menu]);
    expect(post.name.textContent).toBe('Author · now');
    expect(post.name.children).not.toContain(header); expect(post.nameInner.children).not.toContain(header);
    expect(post.nameShell.children).not.toContain(header); expect(post.row.children).not.toContain(header);
  });

  it('does not render inline while a host is unavailable and reconciles after hydration', () => {
    const document = new FakeDocument(); const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet'); const name = document.createElement('div');
    name.setAttribute('data-testid', 'User-Name'); article.appendChild(name); document.appendChild(article);
    const target = { source: 'reply', accountContainer: article, badgeContainer: name };
    expect(reconcilePostLocationHeader(target)).toBeNull(); expect(name.children).toHaveLength(0);
    const shell = document.createElement('div'); const column = document.createElement('div');
    const row = document.createElement('div'); article.removeChild(name); row.appendChild(name);
    const menu = document.createElement('button'); menu.setAttribute('data-testid', 'caret'); row.appendChild(menu);
    column.appendChild(row); shell.appendChild(column); article.appendChild(shell);
    const header = reconcilePostLocationHeader(target);
    expect(column.children).toEqual([header, row]); expect(name.children).toHaveLength(0);
  });

  it('keeps outer and nested tweet ownership independent', () => {
    const document = new FakeDocument(); const outer = tweet(document); const nested = tweet(document, outer.column);
    const outerHeader = reconcilePostLocationHeader(outer.target);
    const nestedHeader = reconcilePostLocationHeader(nested.target);
    expect(reconcilePostLocationHeader(outer.target)).toBe(outerHeader);
    expect(nestedHeader.parentElement).toBe(nested.column);
    expect(removePostLocationHeader(outer.target)).toBe(1);
    expect(nestedHeader.parentElement).toBe(nested.column);
    expect(reconcilePostLocationHeader(outer.target)).not.toBeNull();
    expect(nestedHeader.parentElement).toBe(nested.column);
  });

  it('renders every required format and the one-time country fallback', () => {
    const document = new FakeDocument(); const post = tweet(document);
    const header = reconcilePostLocationHeader(post.target);
    const resolver = vi.fn(() => 'chrome-extension://test/assets/flags/us.png');
    const country = renderLocationBadge(header, { status: 'known', countryCode: 'US',
      countryName: 'United States', regionCode: 'NORTH_AMERICA', regionName: 'North America',
      rawLocation: 'United States', source: 'x-about-account' }, resolver, { postHeader: true });
    expect(country.textContent).toBe('Country:'); expect(country.getAttribute('aria-label')).toBe('Country: United States');
    const image = country.children[0].children[0]; image.dispatchEvent({ type: 'error' }); image.dispatchEvent({ type: 'error' });
    expect(country.textContent).toBe('Country: US');
    renderLocationBadge(header, { status: 'known', regionCode: 'NORTH_AMERICA',
      regionName: 'North America', rawLocation: 'North America', source: 'x-about-account' }, resolver,
    { postHeader: true });
    expect(header.textContent).toBe('Region: 🌐 North America');
    for (const [status, text] of [['unknown', 'Location: Unknown'], ['hidden', 'Location: Hidden'],
      ['missing', 'Location: Not provided'], ['unavailable', 'Location: Unavailable']]) {
      renderLocationBadge(header, { status }, resolver, { postHeader: true }); expect(header.textContent).toBe(text);
    }
  });

  it('removes stale headers when the author row and content column are replaced', () => {
    const document = new FakeDocument(); const post = tweet(document); const old = reconcilePostLocationHeader(post.target);
    const nextColumn = document.createElement('div'); const nextRow = document.createElement('div');
    post.nameInner.removeChild(post.name); nextRow.appendChild(post.name);
    const menu = document.createElement('button'); menu.setAttribute('data-testid', 'caret'); nextRow.appendChild(menu);
    nextColumn.appendChild(nextRow);
    post.shell.removeChild(post.column); post.shell.appendChild(nextColumn);
    const current = reconcilePostLocationHeader(post.target);
    expect(old.parentElement).toBeNull(); expect(nextColumn.children).toEqual([current, nextRow]);
  });
});
