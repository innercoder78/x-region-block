export const SIDEBAR_NAV_ATTRIBUTE = 'data-x-region-block-sidebar-item';

const ANCHORS = Object.freeze([
  ['[data-testid="AppTabBar_More_Menu"]', 'before'],
  ['[data-testid="AppTabBar_Profile_Link"]', 'after'],
  ['[data-testid="AppTabBar_Home_Link"]', 'after'],
]);

export function createXSidebarNavigation(root, options) {
  const { extensionApi, observerFactory, onError = () => {} } = options;
  let active = false;
  let observer = null;
  let item = null;
  const report = () => { try { onError(new Error('Region Blocker options navigation failed.')); } catch { /* contained */ } };
  const open = () => {
    try {
      const result = extensionApi?.runtime?.openOptionsPage?.();
      if (result && typeof result.catch === 'function') result.catch(report);
    } catch { report(); }
  };
  const activate = (event) => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault?.(); event.stopPropagation?.(); open();
  };
  const remove = () => {
    if (item) {
      item.removeEventListener?.('click', activate);
      item.removeEventListener?.('keydown', activate);
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    item = null;
  };
  const reconcile = () => {
    if (!active) return null;
    const existing = typeof root.querySelectorAll === 'function'
      ? [...root.querySelectorAll(`[${SIDEBAR_NAV_ATTRIBUTE}="1"]`)] : [];
    if (item && !item.parentNode) item = null;
    for (const duplicate of existing) {
      if (duplicate !== item && duplicate.parentNode) duplicate.parentNode.removeChild(duplicate);
    }
    let anchor = null; let placement = null;
    for (const [selector, mode] of ANCHORS) {
      anchor = root.querySelectorAll(selector)?.[0] ?? null;
      if (anchor) { placement = mode; break; }
    }
    const parent = anchor?.parentElement;
    if (!parent || typeof parent.insertBefore !== 'function') return item;
    if (!item) {
      item = root.createElement('div');
      item.setAttribute(SIDEBAR_NAV_ATTRIBUTE, '1');
      item.setAttribute('data-testid', 'x-region-block-options-navigation');
      item.setAttribute('role', 'button'); item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Open Region Blocker options');
      item.setAttribute('class', 'x-region-block-sidebar-item');
      const svgNamespace = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
      const icon = root.createElementNS(svgNamespace, 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('class', 'x-region-block-sidebar-icon');
      const circle = root.createElementNS(svgNamespace, 'circle');
      circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
      const slash = root.createElementNS(svgNamespace, 'path');
      slash.setAttribute('d', 'M5.6 5.6 18.4 18.4');
      icon.appendChild(circle); icon.appendChild(slash);
      const label = root.createElement('span'); label.setAttribute('class', 'x-region-block-sidebar-label');
      label.textContent = 'Region Blocker'; item.appendChild(icon); item.appendChild(label);
      item.addEventListener('click', activate); item.addEventListener('keydown', activate);
    }
    const reference = placement === 'before' ? anchor : anchor.nextSibling;
    if (item.parentNode !== parent || item.nextSibling !== reference) parent.insertBefore(item, reference);
    return item;
  };
  const start = () => {
    if (active) return item;
    active = true;
    try { observer = observerFactory(() => reconcile()); observer.observe(root, { childList: true, subtree: true }); }
    catch { observer = null; report(); }
    return reconcile();
  };
  const stop = () => { if (!active) return; active = false; try { observer?.disconnect(); } catch { /* contained */ } observer = null; remove(); };
  return Object.freeze({ start, reconcile, stop, isActive: () => active });
}
