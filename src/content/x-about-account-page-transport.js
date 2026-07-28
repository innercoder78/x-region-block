import { createAccountIdentity } from '../shared/account-identity.js';
import { X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION } from './x-about-account-payload-broker.js';
import {
  X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, createAboutAccountCancelDetail,
  createAboutAccountRequestDetail, parseAboutAccountResponseDetail,
} from '../shared/x-about-account-request-event.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../shared/x-about-account-request-metadata-event.js';

const MAX_IN_FLIGHT = 4;
const START_INTERVAL = 200;
const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const codedError = (code, status = null) => {
  const error = new Error('About Account lookup failed');
  Object.defineProperties(error, { code: { value: code }, status: { value: status } });
  return error;
};
export function createXAboutAccountPageTransport(globalScope, options = {}) {
  const { document, CustomEvent } = globalScope;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let sequence = 0; let active = true; let inFlight = 0; let lastStart = -Infinity;
  let cooldownUntil = 0; let timerPending = false;
  let metadataQuery = null; let metadataAuth = null;
  const queue = []; const pending = new Map(); const waitingMetadata = new Set();
  const dispatch = (type, detail) => document.dispatchEvent(new CustomEvent(type,
    { detail, bubbles: false, cancelable: false, composed: false }));
  const schedule = () => {
    if (!active || timerPending || !queue.length || inFlight >= MAX_IN_FLIGHT) return;
    const wait = Math.max(0, cooldownUntil - now(), START_INTERVAL - (now() - lastStart));
    if (wait > 0) {
      timerPending = true;
      void delay(wait).then(() => { timerPending = false; schedule(); });
      return;
    }
    const entry = queue.shift();
    if (!entry || entry.cancelled) { schedule(); return; }
    entry.started = true; inFlight += 1; lastStart = now();
    dispatch(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, createAboutAccountRequestDetail(entry.id, entry.handle));
    schedule();
  };
  const enqueueAttempt = (entry) => { entry.started = false; queue.push(entry); schedule(); };
  const response = (event) => {
    const result = parseAboutAccountResponseDetail(event?.detail);
    if (result === null) return;
    const entry = pending.get(result.id);
    if (!entry || !entry.started) return;
    entry.started = false; inFlight = Math.max(0, inFlight - 1);
    if (entry.cancelled) { schedule(); return; }
    if (result.ok) { pending.delete(entry.id); entry.cleanup(); entry.resolve(result.payload); schedule(); return; }
    const code = result.code;
    let retryDelay = null;
    if (code === 'HTTP_429' && entry.rateRetries++ < 1) {
      cooldownUntil = Math.max(cooldownUntil, now() + Math.min(300_000, result.retryAfterMs ?? 60_000));
      retryDelay = 0;
    } else if ((code === 'NETWORK' || code === 'HTTP_5XX') && entry.transientRetries < 2) {
      retryDelay = 1000 * (2 ** entry.transientRetries); entry.transientRetries += 1;
    } else if (['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404'].includes(code)
      && entry.metadataRetries++ < 1) {
      entry.rejectedMetadata = ['HTTP_400', 'HTTP_404'].includes(code) ? metadataQuery : metadataAuth;
      entry.metadataKind = ['HTTP_400', 'HTTP_404'].includes(code) ? 'query' : 'auth';
      waitingMetadata.add(entry);
      schedule(); return;
    }
    if (retryDelay !== null) {
      void delay(retryDelay).then(() => { if (active && !entry.cancelled) enqueueAttempt(entry); });
    } else {
      pending.delete(entry.id); entry.cleanup();
      entry.reject(code === 'ABORTED' ? abortError() : codedError(code, result.status));
    }
    schedule();
  };
  const metadata = (event) => {
    try {
      const value = JSON.parse(event?.detail);
      metadataQuery = value.queryId;
      metadataAuth = JSON.stringify([value.headers?.authorization, value.headers?.['x-csrf-token'],
        value.headers?.['x-guest-token'], value.headers?.['x-twitter-auth-type']]);
    } catch { return; }
    for (const entry of [...waitingMetadata]) if (active && !entry.cancelled) {
      if (entry.rejectedMetadata === null && entry.metadataKind === 'query') {
        entry.rejectedMetadata = metadataQuery;
        continue;
      }
      const fresh = entry.metadataKind === 'query'
        ? metadataQuery !== entry.rejectedMetadata : metadataAuth !== entry.rejectedMetadata;
      if (!fresh) continue;
      waitingMetadata.delete(entry);
      // Avoid starting reentrantly inside the ordinary page request being observed.
      void delay(0).then(() => { if (active && !entry.cancelled) enqueueAttempt(entry); });
    }
  };
  document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
  document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadata);
  function loadPayload(identity, context) {
    let canonical;
    try { canonical = createAccountIdentity(identity); } catch { canonical = null; }
    if (!active || canonical === null || canonical.handle !== identity.handle
      || context?.version !== X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION || !context.signal) {
      return Promise.reject(codedError('PAGE_BRIDGE_UNAVAILABLE'));
    }
    if (context.signal.aborted) return Promise.reject(abortError());
    const id = `${now().toString(36).padStart(10, '0')}_${(++sequence).toString(36).padStart(8, '0')}`;
    return new Promise((resolve, reject) => {
      const entry = { id, handle: canonical.handle, resolve, reject, started: false, cancelled: false,
        transientRetries: 0, metadataRetries: 0, rateRetries: 0, cleanup: null };
      const cancel = () => {
        if (entry.cancelled) return; entry.cancelled = true; pending.delete(id);
        const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
        if (entry.started) { inFlight = Math.max(0, inFlight - 1);
          dispatch(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, createAboutAccountCancelDetail(id)); }
        entry.cleanup(); reject(abortError()); schedule();
      };
      entry.cleanup = () => context.signal.removeEventListener('abort', cancel);
      context.signal.addEventListener('abort', cancel, { once: true });
      pending.set(id, entry); enqueueAttempt(entry);
    });
  }
  return Object.freeze({ loadPayload, notifyMetadata: metadata, stop() {
    if (!active) return; active = false;
    document.removeEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
    document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadata);
    for (const entry of pending.values()) {
      entry.cancelled = true; entry.cleanup();
      if (entry.started) dispatch(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, createAboutAccountCancelDetail(entry.id));
      entry.reject(abortError());
    }
    pending.clear(); waitingMetadata.clear(); queue.length = 0; inFlight = 0;
  } });
}
