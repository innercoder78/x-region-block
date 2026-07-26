export function createFakeAbortController(options = {}) {
  const listeners = new Map();
  let abortCount = 0;
  const signal = {
    aborted: false,
    addEventListener(type, listener, listenerOptions) {
      if (options.failAddBefore) throw new Error('fake listener registration failure');
      if (type === 'abort') listeners.set(listener, Boolean(listenerOptions?.once));
      if (options.abortDuringAdd) {
        signal.aborted = true;
        if (options.notifyDuringAdd !== false) {
          if (listeners.get(listener)) listeners.delete(listener);
          listener.call(signal, { type: 'abort', target: signal });
        }
      }
      if (options.failAdd || options.failAddAfter) {
        throw new Error('fake listener registration failure');
      }
    },
    removeEventListener(type, listener) {
      if (options.failRemove) throw new Error('fake listener removal failure');
      if (type === 'abort') listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      abortCount += 1;
      signal.aborted = true;
      const current = [...listeners];
      for (const [listener, once] of current) {
        if (once) listeners.delete(listener);
        listener.call(signal, { type: 'abort', target: signal });
      }
      if (options.failAbort) throw new Error('fake abort failure');
    },
    get abortCount() { return abortCount; },
    get listenerCount() { return listeners.size; },
  };
}
