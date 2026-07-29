import { isOpenOptionsMessage } from '../shared/open-options-message.js';

const response = (ok) => Object.freeze({ ok });

function selectRuntime(scope) {
  if (typeof scope?.browser?.runtime?.onMessage?.addListener === 'function') {
    return { runtime: scope.browser.runtime, promiseApi: true };
  }
  if (typeof scope?.chrome?.runtime?.onMessage?.addListener === 'function') {
    return { runtime: scope.chrome.runtime, promiseApi: false };
  }
  return null;
}

function openOptions(runtime, promiseApi) {
  if (typeof runtime.openOptionsPage !== 'function') return Promise.resolve(false);
  if (promiseApi) {
    try { return Promise.resolve(runtime.openOptionsPage()).then(() => true, () => false); }
    catch { return Promise.resolve(false); }
  }
  return new Promise((resolve) => {
    try {
      runtime.openOptionsPage(() => resolve(!runtime.lastError));
    } catch { resolve(false); }
  });
}

export function registerOpenOptionsMessageHandler(scope = globalThis, onError = () => {}) {
  const selected = selectRuntime(scope);
  if (selected === null) { try { onError(); } catch { /* contained */ } return () => {}; }
  const { runtime, promiseApi } = selected;
  const listener = (message, sender, sendResponse) => {
    if (!isOpenOptionsMessage(message)
      || (sender?.id !== undefined && sender.id !== runtime.id)) return undefined;
    const result = openOptions(runtime, promiseApi).then((ok) => {
      if (!ok) { try { onError(); } catch { /* contained */ } }
      return response(ok);
    });
    if (promiseApi) return result;
    result.then(sendResponse, () => sendResponse(response(false)));
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => { try { runtime.onMessage.removeListener?.(listener); } catch { /* contained */ } };
}
