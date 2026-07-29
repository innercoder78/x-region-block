/** Stable broad geographic regions. This intentionally is not a country database. */
export const REGION_CODES = Object.freeze({
  AFRICA: 'AFRICA',
  ASIA: 'ASIA',
  EUROPE: 'EUROPE',
  MIDDLE_EAST: 'MIDDLE_EAST',
  NORTH_AMERICA: 'NORTH_AMERICA',
  OCEANIA: 'OCEANIA',
  SOUTH_AMERICA: 'SOUTH_AMERICA',
  CARIBBEAN: 'CARIBBEAN',
  CENTRAL_AMERICA: 'CENTRAL_AMERICA',
  UNKNOWN: 'UNKNOWN',
});

const regionNames = {
  AFRICA: 'Africa',
  ASIA: 'Asia',
  EUROPE: 'Europe',
  MIDDLE_EAST: 'Middle East',
  NORTH_AMERICA: 'North America',
  OCEANIA: 'Oceania',
  SOUTH_AMERICA: 'South America',
  CARIBBEAN: 'Caribbean',
  CENTRAL_AMERICA: 'Central America',
  UNKNOWN: 'Unknown',
};

export const REGIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(regionNames).map(([code, name]) => [code, Object.freeze({ code, name })]),
  ),
);

/** Returns a canonical region record, or null for an invalid/unsupported code. */
export function getRegion(code) {
  if (typeof code !== 'string') return null;
  return REGIONS[code.trim().toUpperCase()] ?? null;
}

export function getRegionName(code) {
  return getRegion(code)?.name ?? null;
}

/** Returns a supported canonical region record for an exact English name. */
export function getRegionByName(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim().toLocaleLowerCase('en-US');
  if (normalized === '') return null;
  return Object.values(REGIONS).find(
    (region) => region.code !== REGION_CODES.UNKNOWN
      && region.name.toLocaleLowerCase('en-US') === normalized,
  ) ?? null;
}
