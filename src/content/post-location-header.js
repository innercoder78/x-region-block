export const POST_LOCATION_HEADER_ATTRIBUTE = 'data-x-region-block-location-header';
export const POST_LOCATION_HEADER_VALUE = '1';

const isPost = (target) => target?.source === 'timeline' || target?.source === 'reply';
const isTweetArticle = (element) => String(element?.tagName).toLowerCase() === 'article'
  && element?.getAttribute?.('data-testid') === 'tweet';
const registeredHeaders = new WeakMap();

function nearestTweetArticle(element) {
  let current = element;
  while (current) {
    if (isTweetArticle(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function ownedHeaders(target) {
  if (typeof target?.accountContainer?.querySelectorAll !== 'function') return [];
  const current = [...target.accountContainer.querySelectorAll(
    `[${POST_LOCATION_HEADER_ATTRIBUTE}="${POST_LOCATION_HEADER_VALUE}"]`,
  )].filter((header) => nearestTweetArticle(header) === target.accountContainer);
  const registered = [...(registeredHeaders.get(target.accountContainer) ?? [])]
    .filter((header) => header.getAttribute?.(POST_LOCATION_HEADER_ATTRIBUTE) === POST_LOCATION_HEADER_VALUE);
  return [...new Set([...current, ...registered])];
}

function localDescendant(article, selector) {
  return [...article.querySelectorAll(selector)].find((element) => nearestTweetArticle(element) === article) ?? null;
}

function lowestCommonAncestor(first, second, article) {
  const ancestors = new Set();
  for (let current = first; current && current !== article; current = current.parentElement) ancestors.add(current);
  for (let current = second; current && current !== article; current = current.parentElement) {
    if (ancestors.has(current)) return current;
  }
  return null;
}

function childOnPath(ancestor, descendant) {
  let current = descendant;
  while (current?.parentElement && current.parentElement !== ancestor) current = current.parentElement;
  return current?.parentElement === ancestor ? current : null;
}

function containsElement(container, descendant) {
  for (let current = descendant; current; current = current.parentElement) {
    if (current === container) return true;
  }
  return false;
}

function containsAvatar(candidate) {
  const pending = [...(candidate.children ?? [])];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.getAttribute?.('data-testid')?.startsWith('UserAvatar-')) return true;
    pending.push(...(current.children ?? []));
  }
  return false;
}

function validAuthorRow(article, name, candidate, tweetText, actionGroup) {
  if (!candidate || candidate === article || !candidate.parentElement
    || nearestTweetArticle(candidate) !== article || nearestTweetArticle(candidate.parentElement) !== article
    || !containsElement(candidate, name) || (tweetText && containsElement(candidate, tweetText))
    || (actionGroup && containsElement(candidate, actionGroup)) || containsAvatar(candidate)
    || typeof candidate.parentElement.insertBefore !== 'function') return false;
  return true;
}

/** Resolves the local complete author row using bounded, same-tweet structural landmarks. */
export function resolvePostLocationHeaderHost(target) {
  if (!isPost(target) || !isTweetArticle(target.accountContainer)) return null;
  const name = target.badgeContainer;
  if (name?.getAttribute?.('data-testid') !== 'User-Name'
    || nearestTweetArticle(name) !== target.accountContainer) return null;
  const article = target.accountContainer;
  const tweetText = localDescendant(article, '[data-testid="tweetText"]');
  const menu = localDescendant(article, '[data-testid="caret"]');
  const reply = localDescendant(article, '[data-testid="reply"]');
  const actionGroup = reply?.parentElement ?? null;
  const candidates = [];
  if (menu) candidates.push(lowestCommonAncestor(name, menu, article));
  if (tweetText) {
    const common = lowestCommonAncestor(name, tweetText, article);
    candidates.push(childOnPath(common, name));
  }
  if (actionGroup) {
    const common = lowestCommonAncestor(name, actionGroup, article);
    candidates.push(childOnPath(common, name));
  }
  const authorRow = candidates.find((candidate) => validAuthorRow(
    article, name, candidate, tweetText, actionGroup,
  ));
  const contentColumn = authorRow?.parentElement;
  if (!authorRow || !contentColumn) return null;
  return Object.freeze({ name, authorRow, contentColumn });
}

/** Creates exactly one owned block immediately before the complete local author row. */
export function reconcilePostLocationHeader(target) {
  if (!isPost(target)) return target.badgeContainer;
  // Processor boundary tests and non-DOM consumers may supply abstract containers. Only real
  // tweet articles participate in post-header placement; their author line never receives fallback.
  if (!isTweetArticle(target.accountContainer)) return target.badgeContainer;
  const host = resolvePostLocationHeaderHost(target);
  const headers = ownedHeaders(target);
  if (host === null) {
    for (const header of headers) if (header.parentNode) header.parentNode.removeChild(header);
    return null;
  }
  let header = headers.find((candidate) => candidate.parentElement === host.contentColumn
    && candidate.nextElementSibling === host.authorRow) ?? null;
  for (const candidate of headers) {
    if (candidate !== header && candidate.parentNode) candidate.parentNode.removeChild(candidate);
  }
  if (header === null) {
    header = host.name.ownerDocument.createElement('div');
    header.setAttribute(POST_LOCATION_HEADER_ATTRIBUTE, POST_LOCATION_HEADER_VALUE);
    header.setAttribute('class', 'x-region-block-post-location-header');
    const registered = registeredHeaders.get(target.accountContainer) ?? new Set();
    registered.add(header); registeredHeaders.set(target.accountContainer, registered);
    host.contentColumn.insertBefore(header, host.authorRow);
  }
  return header;
}

export function removePostLocationHeader(target) {
  if (!isPost(target)) return 0;
  const headers = ownedHeaders(target);
  for (const header of headers) if (header.parentNode) header.parentNode.removeChild(header);
  registeredHeaders.delete(target.accountContainer);
  return headers.length;
}
