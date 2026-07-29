import {
  X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, parseAboutAccountCancelDetail,
  parseAboutAccountRequestDetail, serializeAboutAccountResponse,
} from '../shared/x-about-account-request-event.js';
import { metadataHeaderNames, validMetadataHeaderValue } from '../shared/x-about-account-request-metadata-policy.js';
import { X_ABOUT_ACCOUNT_OPERATION_NAME, isValidXAboutAccountQueryId } from '../shared/x-about-account-query.js';
import { executeWithOriginalXFetch, invalidatePrivateXAboutAccountSnapshot,
  readPrivateXAboutAccountSnapshot } from './x-about-account-request-capture.js';

const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const compactPayload = (payload) => {
  const root = payload?.data?.user_result_by_screen_name?.result;
  const profile = root?.about_profile;
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError();
  const readData = (key, valid) => {
    const descriptor = Object.getOwnPropertyDescriptor(profile, key);
    if (descriptor === undefined) return null;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !valid(descriptor.value)) throw new TypeError();
    return descriptor.value;
  };
  const accountBasedIn = readData('account_based_in', (value) => value === null || typeof value === 'string');
  const source = readData('source', (value) => value === null || typeof value === 'string');
  const locationAccurate = readData('location_accurate', (value) => value === null || typeof value === 'boolean');
  return { version: 2, accountBasedIn, source, locationAccurate };
};
const statusCode = (status) => {
  if ([400, 401, 403, 404, 429].includes(status)) return `HTTP_${status}`;
  if (status >= 500) return 'HTTP_5XX';
  return 'UNKNOWN';
};
export function parseRateLimitDelay(headers, now = Date.now()) {
  const maximum = 24 * 60 * 60 * 1000;
  const delays = [];
  const retry = headers?.get?.('retry-after');
  if (/^\d+(?:\.\d+)?$/.test(retry ?? '')) delays.push(Number(retry) * 1000);
  else if (typeof retry === 'string') {
    const timestamp = Date.parse(retry);
    if (Number.isFinite(timestamp)) delays.push(timestamp - now);
  }
  const reset = headers?.get?.('x-rate-limit-reset');
  if (/^\d+$/.test(reset ?? '')) delays.push(Number(reset) * 1000 - now);
  const valid = delays.filter((delay) => Number.isFinite(delay) && delay > 0);
  return valid.length === 0 ? null : Math.min(maximum, Math.max(...valid));
}
export function installXAboutAccountRequestExecutor(globalScope, capture) {
  const { document, CustomEvent, AbortController, location } = globalScope;
  if (!supportedOrigins.has(location.origin)) throw new TypeError('Unsupported origin');
  const requests = new Map();
  let active = true;
  const emit = (detail) => {
    if (!active) return false;
    let serialized;
    try { serialized = serializeAboutAccountResponse(detail); } catch { return false; }
    try {
      document.dispatchEvent(new CustomEvent(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
        { detail: serialized, bubbles: false, cancelable: false, composed: false }));
    } catch { return false; }
    return true;
  };
  const fail = (id, code, status = null, retryAfterMs = null, metadataRevision = null) => emit({
    id, ok: false, code, status, retryAfterMs, metadataRevision,
  });
  const request = async (event) => {
    const command = parseAboutAccountRequestDetail(event?.detail);
    if (!active || command === null || requests.has(command.id)) return;
    let controller = null;
    try {
      controller = new AbortController();
      requests.set(command.id, controller);
      const metadata = readPrivateXAboutAccountSnapshot(capture);
      if (!metadata || metadata.revision !== command.metadataRevision) {
        fail(command.id, 'METADATA_SYNC', null, null, metadata?.revision ?? null); return;
      }
      if (!metadata || metadata.origin !== location.origin || !isValidXAboutAccountQueryId(metadata.queryId)) {
        fail(command.id, 'NO_METADATA'); return;
      }
      const headers = Object.create(null);
      const reusableHeaderNames = new Set(['authorization', 'x-csrf-token', 'x-twitter-active-user',
        'x-twitter-auth-type', 'x-twitter-client-language']);
      for (const name of metadataHeaderNames()) {
        if (!reusableHeaderNames.has(name)) continue;
        const value = metadata.headers?.[name];
        if (value !== undefined) {
          if (!validMetadataHeaderValue(value)) { fail(command.id, 'NO_METADATA'); return; }
          headers[name] = value;
        }
      }
      if (!headers.authorization || !headers['x-csrf-token']) { fail(command.id, 'NO_METADATA'); return; }
      headers['accept-language'] = 'en-US,en;q=0.9';
      const variables = new URLSearchParams({ variables: JSON.stringify({ screenName: command.handle }) });
      const url = `${location.origin}/i/api/graphql/${metadata.queryId}/${X_ABOUT_ACCOUNT_OPERATION_NAME}?${variables}`;
      let response;
      try { response = await executeWithOriginalXFetch(capture, url, { method: 'GET', credentials: 'include',
        headers, signal: controller.signal }); } catch (error) {
        fail(command.id, controller.signal.aborted || error?.name === 'AbortError' ? 'ABORTED' : 'NETWORK'); return;
      }
      let ok; let status; let json;
      try { ok = response?.ok; status = response?.status; json = response?.json; } catch {
        fail(command.id, 'INVALID_RESPONSE'); return;
      }
      if (typeof ok !== 'boolean' || !Number.isInteger(status) || status < 100 || status > 599
        || typeof json !== 'function') {
        fail(command.id, 'INVALID_RESPONSE'); return;
      }
      if (!ok) {
        if ([401, 403].includes(status)) {
          invalidatePrivateXAboutAccountSnapshot(capture, 'authentication', metadata);
        } else if ([400, 404].includes(status)) {
          invalidatePrivateXAboutAccountSnapshot(capture, 'query', metadata);
        }
        let retryAfterMs = null;
        if (status === 429) {
          try { retryAfterMs = parseRateLimitDelay(response.headers); } catch { retryAfterMs = null; }
        }
        fail(command.id, statusCode(status), status, retryAfterMs,
          [400, 401, 403, 404].includes(status) ? metadata.revision : null); return;
      }
      let payload;
      try { payload = compactPayload(await Reflect.apply(json, response, [])); } catch {
        fail(command.id, 'INVALID_PAYLOAD'); return;
      }
      if (!emit({ id: command.id, ok: true, payload })) fail(command.id, 'INVALID_PAYLOAD');
    } catch {
      let aborted = false;
      try { aborted = controller?.signal?.aborted === true; } catch { /* unexpected failure */ }
      fail(command.id, aborted ? 'ABORTED' : 'UNKNOWN');
    } finally { requests.delete(command.id); }
  };
  const cancel = (event) => {
    const command = parseAboutAccountCancelDetail(event?.detail);
    if (command !== null) requests.get(command.id)?.abort();
  };
  document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, request);
  document.addEventListener(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, cancel);
  return Object.freeze({ stop() {
    if (!active) return; active = false;
    document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, request);
    document.removeEventListener(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, cancel);
    for (const controller of requests.values()) controller.abort();
    requests.clear();
  }, isActive: () => active });
}
