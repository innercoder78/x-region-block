export class MetadataEvent {
  constructor(type, options = {}) {
    this.type = type;
    if (Object.prototype.hasOwnProperty.call(options, 'detail')) this.detail = options.detail;
    this.bubbles = options.bubbles ?? false;
    this.cancelable = options.cancelable ?? false;
    this.composed = options.composed ?? false;
  }
}

export class MetadataDocument {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    return true;
  }
}

export function metadataFacades(fetch = () => Promise.resolve({})) {
  const document = new MetadataDocument();
  const common = { location: { origin: 'https://x.com' }, document, Event: MetadataEvent, URLSearchParams };
  return {
    document,
    content: { ...common },
    page: {
      ...common, fetch, CustomEvent: MetadataEvent, URL, Headers, Request,
    },
  };
}

export function observedUrl(queryId = 'query_1', handle = 'Observed') {
  const parameters = new URLSearchParams({
    variables: JSON.stringify({ screen_name: handle, withSafetyModeUserFields: true }),
    features: JSON.stringify({ responsive_web_graphql_exclude_directive_enabled: true }),
    fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
  });
  return `https://x.com/i/api/graphql/${queryId}/UserByScreenName?${parameters}`;
}

export const observedHeaders = Object.freeze({
  authorization: 'Bearer test-only-placeholder',
  'x-csrf-token': 'test-only-csrf',
  'x-twitter-active-user': 'yes',
  cookie: 'must-not-cross',
});
