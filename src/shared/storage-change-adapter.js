/** Creates an adapter without registering a listener until subscribe is called. */
export function createBrowserStorageChangeAdapter(globalScope = globalThis) {
  const browserEvent = globalScope.browser?.storage?.onChanged;
  const chromeEvent = globalScope.chrome?.storage?.onChanged;
  const changeEvent = [browserEvent, chromeEvent].find((event) => event
    && typeof event.addListener === 'function'
    && typeof event.removeListener === 'function');

  if (!changeEvent) throw new Error('No supported extension storage change API is available');

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');

    changeEvent.addListener(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      changeEvent.removeListener(listener);
    };
  }

  return Object.freeze({ subscribe });
}
