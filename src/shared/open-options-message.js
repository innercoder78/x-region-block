export const OPEN_OPTIONS_MESSAGE_VERSION = 1;
export const OPEN_OPTIONS_MESSAGE_TYPE = 'x-region-block/open-options';

export const OPEN_OPTIONS_MESSAGE = Object.freeze({
  version: OPEN_OPTIONS_MESSAGE_VERSION,
  type: OPEN_OPTIONS_MESSAGE_TYPE,
});

export function isOpenOptionsMessage(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && value.version === OPEN_OPTIONS_MESSAGE_VERSION
    && value.type === OPEN_OPTIONS_MESSAGE_TYPE;
}
