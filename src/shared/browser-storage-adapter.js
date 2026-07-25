function chromeOperation(globalScope, operation, argument) {
  return new Promise((resolve, reject) => {
    operation(argument, (result) => {
      const lastError = globalScope.chrome.runtime?.lastError;
      if (lastError) {
        reject(new Error('Extension local storage operation failed'));
        return;
      }
      resolve(result);
    });
  });
}

/** Creates a Promise-based adapter without accessing storage until a method is called. */
export function createBrowserStorageAdapter(globalScope = globalThis) {
  const browserStorage = globalScope.browser?.storage?.local;
  if (browserStorage && ['get', 'set', 'remove'].every((method) => typeof browserStorage[method] === 'function')) {
    return Object.freeze({
      get: (key) => Promise.resolve().then(() => browserStorage.get(key)),
      set: (values) => Promise.resolve().then(() => browserStorage.set(values)),
      remove: (key) => Promise.resolve().then(() => browserStorage.remove(key)),
    });
  }

  const chromeStorage = globalScope.chrome?.storage?.local;
  if (chromeStorage && ['get', 'set', 'remove'].every((method) => typeof chromeStorage[method] === 'function')) {
    return Object.freeze({
      get: (key) => chromeOperation(globalScope, chromeStorage.get.bind(chromeStorage), key),
      set: (values) => chromeOperation(globalScope, chromeStorage.set.bind(chromeStorage), values),
      remove: (key) => chromeOperation(globalScope, chromeStorage.remove.bind(chromeStorage), key),
    });
  }

  throw new Error('No supported extension local storage API is available');
}
