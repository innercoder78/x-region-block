export const POST_LOCATION_HEADER_ATTRIBUTE = 'data-x-region-block-location-header';
export const POST_LOCATION_HEADER_VALUE = '1';

const isPost = (target) => target?.source === 'timeline' || target?.source === 'reply';

function ownedHeaders(article) {
  if (typeof article?.querySelectorAll !== 'function') return [];
  return [...article.querySelectorAll(`[${POST_LOCATION_HEADER_ATTRIBUTE}="${POST_LOCATION_HEADER_VALUE}"]`)];
}

/** Resolve the current local name-line host and create exactly one owned row before it. */
export function reconcilePostLocationHeader(target) {
  if (!isPost(target)) return target.badgeContainer;
  const name = target.badgeContainer;
  const parent = name?.parentElement;
  if (!parent || typeof parent.insertBefore !== 'function') return name;
  const headers = ownedHeaders(target.accountContainer);
  let header = headers.find((candidate) => candidate.parentElement === parent
    && candidate.nextElementSibling === name) ?? null;
  for (const candidate of headers) {
    if (candidate !== header && candidate.parentNode) candidate.parentNode.removeChild(candidate);
  }
  if (header === null) {
    header = name.ownerDocument.createElement('div');
    header.setAttribute(POST_LOCATION_HEADER_ATTRIBUTE, POST_LOCATION_HEADER_VALUE);
    header.setAttribute('class', 'x-region-block-post-location-header');
    parent.insertBefore(header, name);
  }
  return header;
}

export function removePostLocationHeader(target) {
  if (!isPost(target)) return 0;
  let removed = 0;
  for (const header of ownedHeaders(target.accountContainer)) {
    if (header.parentNode) { header.parentNode.removeChild(header); removed += 1; }
  }
  return removed;
}
