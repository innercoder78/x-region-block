import { FILTER_ACTIONS } from '../shared/filter-engine.js';

export const ACCOUNT_ACTION_RENDERER_VERSION = 1;
export const ACCOUNT_ACTION_ATTRIBUTE = 'data-x-region-block-account-action';

function validateContainer(container) {
  if (container === null || typeof container !== 'object' || Array.isArray(container)
    || typeof container.getAttribute !== 'function'
    || typeof container.setAttribute !== 'function'
    || typeof container.removeAttribute !== 'function') {
    throw new TypeError('Invalid account action container');
  }
}

function validateAction(action) {
  if (action !== FILTER_ACTIONS.SHOW && action !== FILTER_ACTIONS.HIGHLIGHT
    && action !== FILTER_ACTIONS.HIDE) {
    throw new TypeError('Invalid account filter action');
  }
}

export function getAccountAction(container) {
  validateContainer(container);
  const value = container.getAttribute(ACCOUNT_ACTION_ATTRIBUTE);
  if (value === FILTER_ACTIONS.HIGHLIGHT) return FILTER_ACTIONS.HIGHLIGHT;
  if (value === FILTER_ACTIONS.HIDE) return FILTER_ACTIONS.HIDE;
  return FILTER_ACTIONS.SHOW;
}

export function applyAccountAction(container, action) {
  validateContainer(container);
  validateAction(action);
  if (action === FILTER_ACTIONS.SHOW) removeAccountAction(container);
  else container.setAttribute(ACCOUNT_ACTION_ATTRIBUTE, action);
  return action;
}

export function removeAccountAction(container) {
  validateContainer(container);
  const value = container.getAttribute(ACCOUNT_ACTION_ATTRIBUTE);
  if (value !== FILTER_ACTIONS.HIGHLIGHT && value !== FILTER_ACTIONS.HIDE) return 0;
  container.removeAttribute(ACCOUNT_ACTION_ATTRIBUTE);
  return 1;
}
