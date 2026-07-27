export const X_ABOUT_ACCOUNT_QUERY_VERSION = 1;
export const X_ABOUT_ACCOUNT_OPERATION_NAME = 'AboutAccountQuery';
export const X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isValidXAboutAccountQueryId(value) {
  return typeof value === 'string' && QUERY_ID_PATTERN.test(value);
}
