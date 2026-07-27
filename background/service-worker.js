(function () {
  'use strict';

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
  function createBrowserStorageAdapter(globalScope = globalThis) {
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

  /** Stable broad geographic regions. This intentionally is not a country database. */
  const REGION_CODES = Object.freeze({
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

  const REGIONS = Object.freeze(
    Object.fromEntries(
      Object.entries(regionNames).map(([code, name]) => [code, Object.freeze({ code, name })]),
    ),
  );

  /** Returns a canonical region record, or null for an invalid/unsupported code. */
  function getRegion(code) {
    if (typeof code !== 'string') return null;
    return REGIONS[code.trim().toUpperCase()] ?? null;
  }

  const COUNTRY_CODES = Object.freeze(
    'AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(','),
  );

  const countryGroups = {
    AFRICA: 'AO,BF,BI,BJ,BW,CD,CF,CG,CI,CM,CV,DJ,DZ,EH,ER,ET,GA,GH,GM,GN,GQ,GW,IO,KE,KM,LR,LS,LY,MA,MG,ML,MR,MU,MW,MZ,NA,NE,NG,RE,RW,SC,SD,SH,SL,SN,SO,SS,ST,SZ,TD,TF,TG,TN,TZ,UG,YT,ZA,ZM,ZW',
    ASIA: 'AF,AM,AZ,BD,BN,BT,CN,GE,HK,ID,IN,JP,KG,KH,KP,KR,KZ,LA,LK,MM,MN,MO,MV,MY,NP,PH,PK,SG,TH,TJ,TL,TM,TW,UZ,VN',
    EUROPE: 'AD,AL,AT,AX,BA,BE,BG,BY,CH,CY,CZ,DE,DK,EE,ES,FI,FO,FR,GB,GG,GI,GR,HR,HU,IE,IM,IS,IT,JE,LI,LT,LU,LV,MC,MD,ME,MK,MT,NL,NO,PL,PT,RO,RS,RU,SE,SI,SJ,SK,SM,UA,VA',
    MIDDLE_EAST: 'AE,BH,EG,IL,IQ,IR,JO,KW,LB,OM,PS,QA,SA,SY,TR,YE',
    NORTH_AMERICA: 'BM,CA,GL,PM,US',
    OCEANIA: 'AS,AU,CC,CK,CX,FJ,FM,GU,HM,KI,MH,MP,NC,NF,NR,NU,NZ,PF,PG,PN,PW,SB,TK,TO,TV,UM,VU,WF,WS',
    SOUTH_AMERICA: 'AR,BO,BR,BV,CL,CO,EC,FK,GF,GS,GY,PE,PY,SR,UY,VE',
    CARIBBEAN: 'AG,AI,AW,BB,BL,BQ,BS,CU,CW,DM,DO,GD,GP,HT,JM,KN,KY,LC,MF,MQ,MS,PR,SX,TC,TT,VC,VG,VI',
    CENTRAL_AMERICA: 'BZ,CR,GT,HN,MX,NI,PA,SV',
    UNKNOWN: 'AQ',
  };

  /**
   * Version 1 is a deterministic product policy, not a political statement.
   * In particular: MX is Central America; EG, IR, TR, and PS are Middle East;
   * CY and RU are Europe; AM, AZ, GE, and KZ are Asia; and AQ is Unknown.
   * Caribbean territories are Caribbean; GF/FK are South America; and
   * GL/BM/PM are North America.
   */
  Object.freeze(
    Object.fromEntries(
      Object.entries(countryGroups).flatMap(([regionCode, countries]) =>
        countries.split(',').map((countryCode) => [countryCode, REGION_CODES[regionCode]]),
      ),
    ),
  );

  const supportedCountryCodes = new Set(COUNTRY_CODES);

  function normalizeCountryCode(value) {
    if (typeof value !== 'string') throw new TypeError('Unsupported country code');
    const code = value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !supportedCountryCodes.has(code)) {
      throw new TypeError('Unsupported country code');
    }
    return code;
  }

  const SETTINGS_SCHEMA_VERSION = 2;

  const OTHER_STATUSES = new Set(['hidden', 'missing', 'unavailable', 'unknown']);

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function freezeSettings(settings) {
    for (const category of ['country', 'region', 'other']) {
      for (const values of Object.values(settings[category])) Object.freeze(values);
      Object.freeze(settings[category]);
    }
    Object.freeze(settings.allowlist);
    return Object.freeze(settings);
  }

  function emptySettings() {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      country: { hide: [], highlight: [], alwaysShow: [] },
      region: { hide: [], highlight: [] },
      other: { hide: [], highlight: [] },
      allowlist: [],
    };
  }

  /** Returns a new complete default tree; no mutable values are shared with callers. */
  function createDefaultSettings() {
    return freezeSettings(emptySettings());
  }

  createDefaultSettings();

  function category(input, name) {
    if (!(name in input)) return {};
    if (!isPlainObject(input[name])) throw new TypeError(`${name} must be a plain object`);
    return input[name];
  }

  function list(input, name) {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new TypeError(`${name} must be an array`);
    return input;
  }

  function unique(values, normalize, name) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      const normalized = normalize(value, name);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
    return result;
  }

  function stringValue(value, name, transform) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`${name} entries must be non-empty strings`);
    }
    return transform(value.trim());
  }

  function countryCode(value, name) {
    try {
      return normalizeCountryCode(value);
    } catch {
      throw new TypeError(`${name} entries must be supported country codes`);
    }
  }

  function regionCode(value, name) {
    if (typeof value !== 'string') throw new TypeError(`${name} entries must be supported region codes`);
    const region = getRegion(value);
    if (region === null || region.code === REGION_CODES.UNKNOWN) {
      throw new TypeError(`${name} entries must be supported non-UNKNOWN region codes`);
    }
    return region.code;
  }

  function otherStatus(value, name) {
    const status = stringValue(value, name, (entry) => entry.toLowerCase());
    if (!OTHER_STATUSES.has(status)) throw new TypeError(`${name} contains unsupported location status: ${status}`);
    return status;
  }

  /**
   * Recognized fields are strict: malformed categories, lists, and entries throw.
   * Unknown properties are intentionally omitted from the canonical result.
   */
  function normalizeSettings(input) {
    if (!isPlainObject(input)) throw new TypeError('settings must be a plain object');

    const country = category(input, 'country');
    const region = category(input, 'region');
    const other = category(input, 'other');
    const settings = emptySettings();

    settings.country.hide = unique(list(country.hide, 'country.hide'), countryCode, 'country.hide');
    settings.country.highlight = unique(
      list(country.highlight, 'country.highlight'),
      countryCode,
      'country.highlight',
    );
    settings.country.alwaysShow = unique(
      list(country.alwaysShow, 'country.alwaysShow'),
      countryCode,
      'country.alwaysShow',
    );
    settings.region.hide = unique(list(region.hide, 'region.hide'), regionCode, 'region.hide');
    settings.region.highlight = unique(
      list(region.highlight, 'region.highlight'),
      regionCode,
      'region.highlight',
    );
    settings.other.hide = unique(list(other.hide, 'other.hide'), otherStatus, 'other.hide');
    settings.other.highlight = unique(
      list(other.highlight, 'other.highlight'),
      otherStatus,
      'other.highlight',
    );
    settings.allowlist = unique(
      list(input.allowlist, 'allowlist'),
      (value, name) => stringValue(value, name, (entry) => entry),
      'allowlist',
    );

    return freezeSettings(settings);
  }

  /** Migrates supported legacy shapes into the current canonical schema. */
  function migrateSettings(input) {
    if (input === undefined || input === null) return createDefaultSettings();
    if (!isPlainObject(input)) throw new TypeError('settings must be a plain object');

    const version = 'schemaVersion' in input ? input.schemaVersion : 0;
    if (!Number.isInteger(version)) throw new TypeError('schemaVersion must be an integer');
    if (version < 0 || version > SETTINGS_SCHEMA_VERSION) {
      throw new RangeError(`unsupported settings schema version: ${version}`);
    }
    return normalizeSettings(input);
  }

  const SETTINGS_STORAGE_KEY = 'xRegionBlock.settings';

  function validateAdapter(adapter) {
    if (adapter === null || typeof adapter !== 'object') {
      throw new TypeError('storageAdapter must provide get, set, and remove methods');
    }
    for (const method of ['get', 'set', 'remove']) {
      if (typeof adapter[method] !== 'function') {
        throw new TypeError(`storageAdapter.${method} must be a function`);
      }
    }
  }

  function hasStoredSettings(values) {
    return values !== null
      && typeof values === 'object'
      && Object.prototype.hasOwnProperty.call(values, SETTINGS_STORAGE_KEY)
      && values[SETTINGS_STORAGE_KEY] !== undefined;
  }

  function persistedSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
  }

  function structurallyEqual(left, right) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function createSettingsRepository(storageAdapter) {
    validateAdapter(storageAdapter);

    async function read() {
      const values = await storageAdapter.get(SETTINGS_STORAGE_KEY);
      return hasStoredSettings(values) ? { found: true, value: values[SETTINGS_STORAGE_KEY] } : { found: false };
    }

    async function persist(settings) {
      await storageAdapter.set({ [SETTINGS_STORAGE_KEY]: persistedSettings(settings) });
      return settings;
    }

    async function loadSettings() {
      const stored = await read();
      return stored.found ? migrateSettings(stored.value) : createDefaultSettings();
    }

    async function saveSettings(input) {
      return persist(normalizeSettings(input));
    }

    async function resetSettings() {
      return persist(createDefaultSettings());
    }

    async function initializeSettings() {
      const stored = await read();
      const canonical = stored.found ? migrateSettings(stored.value) : createDefaultSettings();
      if (!stored.found || !structurallyEqual(stored.value, canonical)) await persist(canonical);
      return canonical;
    }

    return Object.freeze({ loadSettings, saveSettings, resetSettings, initializeSettings });
  }

  async function initializeBackgroundSettings(globalScope = globalThis) {
    const storageAdapter = createBrowserStorageAdapter(globalScope);
    return createSettingsRepository(storageAdapter).initializeSettings();
  }

  initializeBackgroundSettings().catch(() => {
    console.error('Failed to initialize extension settings.');
  });

})();
