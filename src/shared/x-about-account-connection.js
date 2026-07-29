export const X_ABOUT_ACCOUNT_CONNECTION_METHODS = Object.freeze(['web', 'ios', 'android', 'unknown']);
export const X_ABOUT_ACCOUNT_SOURCE_LIMIT = 256;

const labels = Object.freeze({
  web: 'Connection: Web', ios: 'Connection: iOS app', android: 'Connection: Android app',
  unknown: 'Unknown connection method',
});

/** Classifies only explicit account source labels; it never infers geography. */
export function classifyXAboutAccountConnectionSource(value) {
  const rawSource = typeof value === 'string' ? value.trim() : null;
  const retained = rawSource && rawSource.length <= X_ABOUT_ACCOUNT_SOURCE_LIMIT ? rawSource : null;
  const normalized = retained?.toLowerCase() ?? '';
  let method = 'unknown';
  if (/^(?:web|web app|twitter web app|x web)$/.test(normalized)) method = 'web';
  else if (/(?:^|\s)(?:app store|ios|iphone|ipad)(?:\s|$)/.test(normalized)) method = 'ios';
  else if (/(?:^|\s)(?:google play|play store|android)(?:\s|$)/.test(normalized)) method = 'android';
  return Object.freeze({ method, label: labels[method], rawSource: retained });
}
