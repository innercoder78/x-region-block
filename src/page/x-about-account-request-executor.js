import {
  X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
  X_ABOUT_ACCOUNT_RESPONSE_LIMIT, parseAboutAccountCancelDetail,
  parseAboutAccountRequestDetail,
} from '../shared/x-about-account-request-event.js';
import { metadataHeaderNames, validMetadataHeaderValue } from '../shared/x-about-account-request-metadata-policy.js';
import { X_ABOUT_ACCOUNT_OPERATION_NAME, isValidXAboutAccountQueryId } from '../shared/x-about-account-query.js';
import { executeWithOriginalXFetch, readPrivateXAboutAccountSnapshot } from './x-about-account-request-capture.js';

const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const statusCode = (status) => {
  if ([400, 401, 403, 404, 429].includes(status)) return `HTTP_${status}`;
  if (status >= 500) return 'HTTP_5XX';
  return 'UNKNOWN';
};
export function parseRateLimitDelay(headers, now = Date.now()) {
  const retry = headers?.get?.('retry-after');
  if (/^\d+$/.test(retry ?? '')) return Math.min(300_000, Number(retry) * 1000);
  const reset = headers?.get?.('x-rate-limit-reset');
  if (/^\d+$/.test(reset ?? '')) return Math.min(300_000, Math.max(0, Number(reset) * 1000 - now));
  return 60_000;
}
export function installXAboutAccountRequestExecutor(globalScope, capture) {
  const { document, CustomEvent, AbortController, location } = globalScope;
  if (!supportedOrigins.has(location.origin)) throw new TypeError('Unsupported origin');
  const requests = new Map();
  let active = true;
  const emit = (detail) => {
    if (!active || JSON.stringify(detail).length > X_ABOUT_ACCOUNT_RESPONSE_LIMIT) return;
    document.dispatchEvent(new CustomEvent(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
      { detail, bubbles: false, cancelable: false, composed: false }));
  };
  const fail = (id, code, status = null, retryAfterMs = null) => emit({
    version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id, ok: false, code, status, retryAfterMs,
  });
  const request = async (event) => {
    const command = parseAboutAccountRequestDetail(event?.detail);
    if (!active || command === null || requests.has(command.id)) return;
    const controller = new AbortController();
    requests.set(command.id, controller);
    try {
      const metadata = readPrivateXAboutAccountSnapshot(capture);
      if (!metadata || metadata.origin !== location.origin || !isValidXAboutAccountQueryId(metadata.queryId)) {
        fail(command.id, 'NO_METADATA'); return;
      }
      const headers = Object.create(null);
      for (const name of metadataHeaderNames()) {
        const value = metadata.headers?.[name];
        if (value !== undefined) {
          if (!validMetadataHeaderValue(value)) { fail(command.id, 'NO_METADATA'); return; }
          headers[name] = value;
        }
      }
      if (!headers.authorization || !headers['x-csrf-token']) { fail(command.id, 'NO_METADATA'); return; }
      headers.accept = 'application/json'; headers['accept-language'] = 'en-US,en;q=0.9';
      const variables = new URLSearchParams({ variables: JSON.stringify({ screenName: command.handle }) });
      const url = `${location.origin}/i/api/graphql/${metadata.queryId}/${X_ABOUT_ACCOUNT_OPERATION_NAME}?${variables}`;
      let response;
      try { response = await executeWithOriginalXFetch(capture, url, { method: 'GET', credentials: 'include',
        cache: 'no-store', redirect: 'error', headers, signal: controller.signal }); } catch (error) {
        fail(command.id, controller.signal.aborted || error?.name === 'AbortError' ? 'ABORTED' : 'NETWORK'); return;
      }
      if (!response || typeof response.status !== 'number' || typeof response.json !== 'function') {
        fail(command.id, 'INVALID_RESPONSE'); return;
      }
      if (!response.ok) {
        fail(command.id, statusCode(response.status), response.status,
          response.status === 429 ? parseRateLimitDelay(response.headers) : null); return;
      }
      let payload;
      try { payload = await response.json(); } catch { fail(command.id, 'INVALID_PAYLOAD'); return; }
      const detail = { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: command.id, ok: true, payload };
      let serialized;
      try { serialized = JSON.stringify(detail); } catch { serialized = ''; }
      if (!serialized || serialized.length > X_ABOUT_ACCOUNT_RESPONSE_LIMIT) fail(command.id, 'INVALID_PAYLOAD');
      else emit(detail);
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
