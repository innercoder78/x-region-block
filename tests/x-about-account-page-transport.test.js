import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountPageTransport } from '../src/content/x-about-account-page-transport.js';
import { X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION } from '../src/content/x-about-account-payload-broker.js';
import { X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, parseAboutAccountRequestDetail,
  serializeAboutAccountResponse } from '../src/shared/x-about-account-request-event.js';

class Event { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
class Document {
  constructor() { this.listeners = new Map(); this.events = []; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== listener)); }
  dispatchEvent(event) { this.events.push({ event, time: Date.now() }); for (const listener of this.listeners.get(event.type) ?? []) listener(event); return true; }
}
const recovery = (generation = 1, queryId = 'query_one', authenticationFingerprint = 'auth_one') =>
  ({ version: 1, generation, queryId, authenticationFingerprint });
const context = (signal) => ({ version: X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION, signal });
const identity = (handle) => createAccountIdentity({ handle, accountId: null, source: null });

describe('global About Account page scheduler', () => {
  afterEach(() => vi.useRealTimers());
  it('paces FIFO work, limits concurrency, validates responses, and times out a slot', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const document = new Document();
    const transport = createXAboutAccountPageTransport({ document, CustomEvent: Event }, { recoveryState: recovery() });
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const promises = controllers.map((controller, index) => transport.loadPayload(identity(`user${index}`), context(controller.signal)));
    promises.forEach((promise) => { void promise.catch(() => {}); });
    await vi.advanceTimersByTimeAsync(800);
    const starts = document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE);
    expect(starts.map(({ event }) => parseAboutAccountRequestDetail(event.detail).handle)).toEqual(['user0', 'user1', 'user2', 'user3']);
    expect(starts.every(({ event }) => typeof event.detail === 'string')).toBe(true);
    expect(starts.map(({ time }) => time)).toEqual([0, 200, 400, 600]);
    const first = parseAboutAccountRequestDetail(starts[0].event.detail);
    document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, { detail: serializeAboutAccountResponse({ id: first.id, ok: true, payload: { ok: true } }) }));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE)).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(promises[1]).rejects.toMatchObject({ code: 'PAGE_BRIDGE_UNAVAILABLE' });
    expect(document.events.some(({ event }) => event.type === X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE && typeof event.detail === 'string')).toBe(true);
    controllers.forEach((controller) => controller.abort()); transport.stop();
    await expect(promises[0]).resolves.toEqual({ ok: true });
    await Promise.allSettled(promises);
  });

  it('waits for the first genuinely fresh validated state after global rejection', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const document = new Document(); const rejected = vi.fn();
    const transport = createXAboutAccountPageTransport({ document, CustomEvent: Event },
      { recoveryState: recovery(), onMetadataRejected: rejected });
    const controller = new AbortController();
    const promise = transport.loadPayload(identity('OpenAI'), context(controller.signal));
    const start = document.events.find(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE);
    const command = parseAboutAccountRequestDetail(start.event.detail);
    document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, { detail: serializeAboutAccountResponse({
      id: command.id, ok: false, code: 'HTTP_401', status: 401, retryAfterMs: null,
    }) }));
    expect(rejected).toHaveBeenCalledWith('auth');
    expect(transport.updateRecoveryState(recovery(2))).toBe(true);
    await vi.runAllTimersAsync();
    expect(document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE)).toHaveLength(1);
    transport.updateRecoveryState(recovery(3, 'query_one', 'auth_two'));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE)).toHaveLength(2);
    controller.abort(); await expect(promise).rejects.toMatchObject({ name: 'AbortError' }); transport.stop();
  });

  it('shares a 429 cooldown and applies deterministic one- and two-second network retries', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const document = new Document();
    const transport = createXAboutAccountPageTransport({ document, CustomEvent: Event }, { recoveryState: recovery() });
    const rateController = new AbortController();
    const ratePromise = transport.loadPayload(identity('rate'), context(rateController.signal));
    void ratePromise.catch(() => {});
    let starts = document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE);
    let command = parseAboutAccountRequestDetail(starts.at(-1).event.detail);
    document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, { detail: serializeAboutAccountResponse({
      id: command.id, ok: false, code: 'HTTP_429', status: 429, retryAfterMs: 60_000,
    }) }));
    const queuedController = new AbortController();
    const queued = transport.loadPayload(identity('queued'), context(queuedController.signal));
    void queued.catch(() => {});
    await vi.advanceTimersByTimeAsync(59_999);
    starts = document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    starts = document.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE);
    expect(parseAboutAccountRequestDetail(starts[1].event.detail).handle).toBe('queued');
    command = parseAboutAccountRequestDetail(starts[1].event.detail);
    document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, { detail: serializeAboutAccountResponse({
      id: command.id, ok: true, payload: { ok: true },
    }) }));
    await expect(queued).resolves.toEqual({ ok: true });
    rateController.abort(); queuedController.abort(); await Promise.allSettled([queued]); transport.stop();

    vi.setSystemTime(0);
    const networkDocument = new Document();
    const networkTransport = createXAboutAccountPageTransport({ document: networkDocument, CustomEvent: Event },
      { recoveryState: recovery() });
    const networkController = new AbortController();
    const networkPromise = networkTransport.loadPayload(identity('network'), context(networkController.signal));
    void networkPromise.catch(() => {});
    for (const expectedTime of [1000, 3000]) {
      const latest = networkDocument.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE).at(-1);
      const request = parseAboutAccountRequestDetail(latest.event.detail);
      networkDocument.dispatchEvent(new Event(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, { detail: serializeAboutAccountResponse({
        id: request.id, ok: false, code: 'NETWORK', status: null, retryAfterMs: null,
      }) }));
      await vi.advanceTimersByTimeAsync(expectedTime - Date.now());
      expect(networkDocument.events.filter(({ event }) => event.type === X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE).at(-1).time)
        .toBe(expectedTime);
    }
    networkController.abort(); await expect(networkPromise).rejects.toMatchObject({ name: 'AbortError' });
    networkTransport.stop();
  });
});
