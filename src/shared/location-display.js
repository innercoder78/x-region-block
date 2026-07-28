import { createLocationResult, LOCATION_STATUSES } from './location-model.js';

export const LOCATION_DISPLAY_MODEL_VERSION = 1;
export const LOCATION_GLOBE_SYMBOL = '🌐';

export const LOCATION_STATUS_LABELS = Object.freeze({
  hidden: 'Location hidden',
  missing: 'Location not provided',
  unavailable: 'Location unavailable',
  unknown: 'Location unknown',
});

function createRegionDescriptor(code, name, label, ariaLabel) {
  return Object.freeze({
    code,
    name,
    symbol: LOCATION_GLOBE_SYMBOL,
    label,
    title: label,
    ariaLabel,
  });
}

/**
 * Creates plain-text presentation data from a canonicalized location result.
 * A future renderer must assign these values with textContent, safe attributes,
 * or equivalent browser APIs; this module deliberately performs no rendering.
 */
export function createLocationDisplayModel(input) {
  const location = createLocationResult(input);

  if (location.status !== LOCATION_STATUSES.KNOWN) {
    const label = LOCATION_STATUS_LABELS[location.status];
    return Object.freeze({
      version: LOCATION_DISPLAY_MODEL_VERSION,
      status: location.status,
      country: null,
      region: createRegionDescriptor(null, null, label, label),
    });
  }

  const countryName = location.countryName.trim();
  const country = Object.freeze({
    code: location.countryCode,
    name: countryName,
    label: countryName,
    title: countryName,
    ariaLabel: `Country: ${countryName}`,
  });
  const region = location.regionCode === null
    ? createRegionDescriptor(null, null, 'Unknown region', 'Region: Unknown')
    : createRegionDescriptor(
      location.regionCode,
      location.regionName,
      location.regionName,
      `Region: ${location.regionName}`,
    );

  return Object.freeze({
    version: LOCATION_DISPLAY_MODEL_VERSION,
    status: location.status,
    country,
    region,
  });
}
