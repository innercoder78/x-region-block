import { createAccountIdentity } from '../shared/account-identity.js';
import { X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION } from './x-about-account-payload-broker.js';
import {
  X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, serializeAboutAccountCancel,
  serializeAboutAccountRequest, parseAboutAccountResponseDetail,
} from '../shared/x-about-account-request-event.js';
import { isValidXAboutAccountQueryId } from '../shared/x-about-account-query.js';

const MAX_IN_FLIGHT = 4;
const START_INTERVAL = 200;
const BRIDGE_TIMEOUT = 30_000;
const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const codedError = (code, status = null) => {
  const error = new Error('About Account lookup failed');
  Object.defineProperties(error, { code: { value: code }, status: { value: status } });
  return error;
};
export function createXAboutAccountPageTransport(globalScope, options = {}) {
  const { document, CustomEvent } = globalScope;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  const onMetadataRejected = options.onMetadataRejected ?? (() => {});
  let sequence = 0; let active = true; let inFlight = 0; let lastStart = -Infinity;
  let cooldownUntil = 0; let scheduleTimer = null; let resumeTimer = null;
  let recoveryState = null;
  const blockedMetadata = { auth: new Set(), query: new Set() };
  const queue = []; const pending = new Map(); const waitingMetadata = new Set();
  const dispatch = (type, detail) => document.dispatchEvent(new CustomEvent(type,
    { detail, bubbles: false, cancelable: false, composed: false }));
  const dispatchCancellation = (id) => {
    try { dispatch(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, serializeAboutAccountCancel(id)); }
    catch { /* Cancellation cleanup never depends on page event delivery. */ }
  };
  const schedule = () => {
    if (!active || scheduleTimer !== null || blockedMetadata.auth.size > 0
      || blockedMetadata.query.size > 0 || !queue.length || inFlight >= MAX_IN_FLIGHT) return;
    const wait = Math.max(0, cooldownUntil - now(), START_INTERVAL - (now() - lastStart));
    if (wait > 0) {
      scheduleTimer = setTimer(() => { scheduleTimer = null; schedule(); }, wait);
      return;
    }
    const entry = queue.shift();
    if (!entry || entry.cancelled) { schedule(); return; }
    entry.started = true; inFlight += 1; lastStart = now();
    entry.attemptRevision = recoveryState?.revision ?? null;
    entry.attemptAuthentication = recoveryState?.authenticationFingerprint ?? null;
    entry.attemptQuery = recoveryState?.queryId ?? null;
    if (entry.attemptRevision === null) {
      entry.started = false; inFlight -= 1; pending.delete(entry.id); entry.cleanup();
      entry.reject(codedError('PAGE_BRIDGE_UNAVAILABLE')); schedule(); return;
    }
    try { dispatch(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      serializeAboutAccountRequest(entry.id, entry.handle, entry.attemptRevision)); }
    catch {
      entry.started = false; inFlight -= 1; pending.delete(entry.id); entry.cleanup();
      entry.reject(codedError('PAGE_BRIDGE_UNAVAILABLE')); schedule(); return;
    }
    entry.attemptTimer = setTimer(() => {
      if (!active || !entry.started || pending.get(entry.id) !== entry) return;
      entry.attemptTimer = null; entry.started = false; inFlight = Math.max(0, inFlight - 1);
      dispatchCancellation(entry.id);
      pending.delete(entry.id); entry.cleanup(); entry.reject(codedError('PAGE_BRIDGE_UNAVAILABLE'));
      schedule();
    }, BRIDGE_TIMEOUT);
    schedule();
  };
  const enqueueAttempt = (entry) => { entry.started = false; queue.push(entry); schedule(); };
  const response = (event) => {
    const result = parseAboutAccountResponseDetail(event?.detail);
    if (result === null) return;
    const entry = pending.get(result.id);
    if (!entry || !entry.started) return;
    if (entry.attemptTimer !== null) { clearTimer(entry.attemptTimer); entry.attemptTimer = null; }
    entry.started = false; inFlight = Math.max(0, inFlight - 1);
    if (entry.cancelled) { schedule(); return; }
    if (result.ok) { pending.delete(entry.id); entry.cleanup(); entry.resolve(result.payload); schedule(); return; }
    const rejectionCode = ['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404'].includes(result.code);
    const code = rejectionCode && result.metadataRevision !== entry.attemptRevision
      ? 'METADATA_SYNC' : result.code;
    let retryDelay = null;
    if (code === 'METADATA_SYNC') {
      if (entry.syncRetries++ < 2) retryDelay = 0;
    } else if (code === 'HTTP_429') {
      cooldownUntil = Math.max(cooldownUntil, now() + Math.min(300_000, result.retryAfterMs ?? 60_000));
      if (entry.rateRetries++ < 1) retryDelay = 0;
    } else if ((code === 'NETWORK' || code === 'HTTP_5XX') && entry.transientRetries < 2) {
      retryDelay = 1000 * (2 ** entry.transientRetries); entry.transientRetries += 1;
    } else if (['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404'].includes(code)) {
      entry.metadataKind = ['HTTP_400', 'HTTP_404'].includes(code) ? 'query' : 'auth';
      entry.rejectedMetadata = entry.metadataKind === 'query' ? entry.attemptQuery : entry.attemptAuthentication;
      if (entry.rejectedMetadata !== null) blockedMetadata[entry.metadataKind].add(entry.rejectedMetadata);
      if (result.metadataRevision === entry.attemptRevision) {
        try { onMetadataRejected(entry.metadataKind, entry.attemptRevision,
          entry.rejectedMetadata); } catch { /* categorized by owner */ }
      }
      const current = entry.metadataKind === 'query'
        ? recoveryState?.queryId : recoveryState?.authenticationFingerprint;
      const rejectedRevision = result.metadataRevision ?? entry.attemptRevision;
      entry.rejectedRevision = rejectedRevision;
      const fresh = current !== null && recoveryState?.revision !== rejectedRevision
        && current !== entry.rejectedMetadata;
      if (fresh) blockedMetadata[entry.metadataKind].delete(entry.rejectedMetadata);
      if (entry.metadataRetries++ < 1) {
        if (fresh) retryDelay = 0;
        else { waitingMetadata.add(entry); schedule(); return; }
      }
    }
    if (retryDelay !== null) {
      entry.delayTimer = setTimer(() => {
        entry.delayTimer = null; if (active && !entry.cancelled) enqueueAttempt(entry);
      }, retryDelay);
    } else {
      pending.delete(entry.id); entry.cleanup();
      entry.reject(code === 'ABORTED' ? abortError() : codedError(code, result.status));
    }
    schedule();
  };
  const updateRecoveryState = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== 5 || value.version !== 1
      || !Number.isInteger(value.generation) || value.generation < 1
      || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 2_147_483_647
      || !isValidXAboutAccountQueryId(value.queryId)
      || typeof value.authenticationFingerprint !== 'string'
      || value.authenticationFingerprint.length < 1 || value.authenticationFingerprint.length > 65_536) return false;
    recoveryState = { version: 1, generation: value.generation, revision: value.revision, queryId: value.queryId,
      authenticationFingerprint: value.authenticationFingerprint };
    for (const [kind, current] of [['query', recoveryState.queryId],
      ['auth', recoveryState.authenticationFingerprint]]) {
      for (const rejected of [...blockedMetadata[kind]]) {
        if (rejected !== current) blockedMetadata[kind].delete(rejected);
      }
    }
    for (const entry of [...waitingMetadata]) if (active && !entry.cancelled) {
      const fresh = entry.metadataKind === 'query'
        ? recoveryState.revision !== entry.rejectedRevision && recoveryState.queryId !== entry.rejectedMetadata
        : recoveryState.revision !== entry.rejectedRevision
          && recoveryState.authenticationFingerprint !== entry.rejectedMetadata;
      if (!fresh) continue;
      waitingMetadata.delete(entry);
      // Avoid starting reentrantly inside the ordinary page request being observed.
      entry.delayTimer = setTimer(() => {
        entry.delayTimer = null; if (active && !entry.cancelled) enqueueAttempt(entry);
      }, 0);
    }
    if (active && resumeTimer === null) resumeTimer = setTimer(() => {
      resumeTimer = null; schedule();
    }, 0);
    return true;
  };
  document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
  if (options.recoveryState !== undefined && !updateRecoveryState(options.recoveryState)) {
    throw new TypeError('Invalid recovery state');
  }
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
        transientRetries: 0, metadataRetries: 0, syncRetries: 0, rateRetries: 0, cleanup: null,
        attemptRevision: null, attemptAuthentication: null, attemptQuery: null, rejectedRevision: null,
        attemptTimer: null, delayTimer: null };
      const cancel = () => {
        if (entry.cancelled) return; entry.cancelled = true; pending.delete(id);
        const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
        waitingMetadata.delete(entry);
        if (entry.attemptTimer !== null) { clearTimer(entry.attemptTimer); entry.attemptTimer = null; }
        if (entry.delayTimer !== null) { clearTimer(entry.delayTimer); entry.delayTimer = null; }
        if (entry.started) { inFlight = Math.max(0, inFlight - 1); dispatchCancellation(id); }
        entry.cleanup(); reject(abortError()); schedule();
      };
      entry.cleanup = () => context.signal.removeEventListener('abort', cancel);
      context.signal.addEventListener('abort', cancel, { once: true });
      pending.set(id, entry); enqueueAttempt(entry);
    });
  }
  return Object.freeze({ loadPayload, updateRecoveryState, stop() {
    if (!active) return; active = false;
    if (scheduleTimer !== null) { clearTimer(scheduleTimer); scheduleTimer = null; }
    if (resumeTimer !== null) { clearTimer(resumeTimer); resumeTimer = null; }
    document.removeEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
    for (const entry of pending.values()) {
      entry.cancelled = true; entry.cleanup();
      if (entry.attemptTimer !== null) clearTimer(entry.attemptTimer);
      if (entry.delayTimer !== null) clearTimer(entry.delayTimer);
      if (entry.started) dispatchCancellation(entry.id);
      entry.reject(abortError());
    }
    pending.clear(); waitingMetadata.clear(); blockedMetadata.auth.clear();
    blockedMetadata.query.clear(); queue.length = 0; inFlight = 0;
  } });
}
