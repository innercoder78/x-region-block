(function () {
  'use strict';

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION = 2;

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE =
    'x-region-block:about-account-request-metadata';

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE =
    'x-region-block:request-about-account-request-metadata';

  const SUPPORTED_HOSTNAMES = Object.freeze(['x.com', 'twitter.com']);

  const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const DECIMAL_ID_PATTERN = /^\d+$/;
  const SUPPORTED_HOSTS = new Set(['x.com', 'twitter.com']);

  /** Safe, non-sensitive contexts in which a future caller may observe an account. */
  const ACCOUNT_IDENTITY_SOURCES = Object.freeze([
    'profile',
    'timeline',
    'reply',
    'search',
    'notification',
  ]);

  const accountIdentitySources = new Set(ACCOUNT_IDENTITY_SOURCES);

  /**
   * Application paths which must never be interpreted as account handles.
   * The frozen array is the single documented definition; the private Set only
   * provides efficient, case-insensitive membership checks.
   */
  const RESERVED_X_ROUTE_SEGMENTS = Object.freeze([
    'home',
    'explore',
    'notifications',
    'messages',
    'i',
    'settings',
    'compose',
    'search',
    'hashtag',
    'intent',
    'share',
    'login',
    'logout',
    'signup',
    'tos',
    'privacy',
    'about',
    'download',
    'jobs',
  ]);

  const reservedRoutes = new Set(RESERVED_X_ROUTE_SEGMENTS);

  function normalizeXHandle(value) {
    if (typeof value !== 'string') throw new TypeError('X handle must be a string');

    const trimmed = value.trim();
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    if (!HANDLE_PATTERN.test(handle)) throw new TypeError('Invalid X handle');
    return handle.toLowerCase();
  }

  function normalizeAccountId(value) {
    if (value == null) return null;
    if (typeof value !== 'string') throw new TypeError('accountId must be a decimal string or null');
    const trimmed = value.trim();
    if (!DECIMAL_ID_PATTERN.test(trimmed)) throw new TypeError('Invalid accountId');
    return trimmed;
  }

  function normalizeSource(value) {
    if (value == null) return null;
    if (typeof value !== 'string') throw new TypeError('source must be a string or null');
    const normalized = value.trim().toLowerCase();
    if (!accountIdentitySources.has(normalized)) throw new TypeError('Invalid account source');
    return normalized;
  }

  /** Creates a minimal value object and deliberately copies no unrelated input. */
  function createAccountIdentity(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Account identity input must be an object');
    }

    const handle = normalizeXHandle(input.handle);
    const displayHandle = `@${handle}`;
    return Object.freeze({
      handle,
      displayHandle,
      profileUrl: `https://x.com/${handle}`,
      accountId: normalizeAccountId(input.accountId),
      allowlistKey: displayHandle,
      source: normalizeSource(input.source),
    });
  }

  function isSafeSupportedUrl(url) {
    return (
      url.protocol === 'https:' &&
      SUPPORTED_HOSTS.has(url.hostname.toLowerCase()) &&
      url.username === '' &&
      url.password === '' &&
      url.port === ''
    );
  }

  function parseSupportedAbsoluteUrl(value) {
    if (typeof value === 'string') {
      // URL() repairs malformed slashes and backslashes, so string inputs must
      // have the documented absolute spelling before component validation.
      if (value.includes('\\') || !/^https:\/\/[A-Za-z0-9]/i.test(value)) return null;
    } else if (!(value instanceof URL)) {
      return null;
    }

    try {
      const url = value instanceof URL ? value : new URL(value);
      return isSafeSupportedUrl(url) ? url : null;
    } catch {
      return null;
    }
  }

  function identityFromUrl(url, identityOptions) {
    if (!isSafeSupportedUrl(url)) return null;
    const encodedSegments = url.pathname.split('/').slice(1);
    const encodedSegment = encodedSegments[0];
    if (!encodedSegment) return null;

    let segments;
    try {
      // Decode every segment, even though only the first identifies the account,
      // so malformed encoding anywhere in the supplied path is rejected.
      segments = encodedSegments.map((segment) => decodeURIComponent(segment));
    } catch {
      return null;
    }
    const [segment] = segments;
    if (reservedRoutes.has(segment.toLowerCase())) return null;
    try {
      return createAccountIdentity({ ...identityOptions, handle: segment });
    } catch {
      return null;
    }
  }

  /**
   * Invalid direct handles are programmer input errors and throw. URL-like input
   * instead returns null when it is unsafe, unsupported, or not an account path.
   */
  function parseXAccountReference(value, options = {}) {
    if (typeof value !== 'string') throw new TypeError('Account reference must be a string');
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Account reference options must be an object');
    }

    const trimmed = value.trim();
    const identityOptions = { accountId: options.accountId, source: options.source };
    const relative = trimmed.startsWith('/') && !trimmed.startsWith('//');
    const looksLikeUrl = relative || trimmed.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed);

    if (!looksLikeUrl) return createAccountIdentity({ ...identityOptions, handle: trimmed });
    if (trimmed.startsWith('//')) return null;

    let url;
    try {
      if (relative) {
        if (trimmed.includes('\\')) return null;
        const base = parseSupportedAbsoluteUrl(options.baseUrl);
        if (!base) return null;
        url = new URL(trimmed, base);
      } else {
        url = parseSupportedAbsoluteUrl(trimmed);
        if (!url) return null;
      }
    } catch {
      return null;
    }
    return identityFromUrl(url, identityOptions);
  }

  const X_ROUTE_CLASSIFIER_VERSION = 1;

  const supportedHostnames = new Set(SUPPORTED_HOSTNAMES);
  const reservedSegments = new Set(RESERVED_X_ROUTE_SEGMENTS);
  const profileSections = new Map([
    ['with_replies', 'replies'],
    ['media', 'media'],
    ['likes', 'likes'],
    ['highlights', 'highlights'],
    ['articles', 'articles'],
  ]);

  function descriptor(type, handle = null, profileSection = null, statusId = null) {
    return Object.freeze({
      version: X_ROUTE_CLASSIFIER_VERSION,
      type,
      handle,
      profileSection,
      statusId,
    });
  }

  const UNSUPPORTED = descriptor('unsupported');
  const hasAsciiControl = (value) => [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  function parseSegments(value) {
    if (hasAsciiControl(value)) return null;
    const trimmed = value.trim();
    // URL repairs malformed slash and backslash spellings, so reject them first.
    if (!/^https:\/\/[A-Za-z0-9]/i.test(trimmed) || trimmed.includes('\\')) return null;
    const afterScheme = trimmed.slice(trimmed.indexOf('//') + 2);
    const authorityEnd = afterScheme.search(/[/?#]/);
    const authority = authorityEnd < 0 ? afterScheme : afterScheme.slice(0, authorityEnd);
    if (authority.includes(':') || authority.includes('@')) return null;

    let rawPathname = '/';
    if (authorityEnd >= 0 && afterScheme[authorityEnd] === '/') {
      const pathAndSuffix = afterScheme.slice(authorityEnd);
      const suffixStart = pathAndSuffix.search(/[?#]/);
      rawPathname = suffixStart < 0 ? pathAndSuffix : pathAndSuffix.slice(0, suffixStart);
    }

    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !supportedHostnames.has(url.hostname.toLowerCase())
      || url.username !== '' || url.password !== '' || url.port !== '') return null;

    const encoded = rawPathname.split('/').slice(1);
    if (encoded.at(-1) === '') encoded.pop();
    if (encoded.some((segment) => segment === '')) return null;
    try {
      const segments = encoded.map((segment) => decodeURIComponent(segment));
      return segments.some((segment) => segment === '.' || segment === '..'
        || segment.includes('/') || segment.includes('\\')
        || hasAsciiControl(segment))
        ? null : segments;
    } catch {
      return null;
    }
  }

  function canonicalHandle(segment) {
    try {
      const handle = normalizeXHandle(segment);
      return segment.toLowerCase() === handle && !reservedSegments.has(handle) ? handle : null;
    } catch {
      return null;
    }
  }

  /** Classifies one explicitly supplied absolute X or Twitter URL. */
  function classifyXRoute(value) {
    if (typeof value !== 'string') throw new TypeError('X route URL must be a string');
    const segments = parseSegments(value);
    if (segments === null) return UNSUPPORTED;
    const lower = segments.map((segment) => segment.toLowerCase());

    if (segments.length === 0 || (segments.length === 1 && lower[0] === 'home')) {
      return descriptor('home');
    }
    if ((segments.length === 1 && lower[0] === 'explore')
      || (segments.length === 3 && lower[0] === 'explore'
        && lower[1] === 'tabs' && segments[2] !== '')) return descriptor('explore');
    if (segments.length === 1 && lower[0] === 'search') return descriptor('search');
    if ((segments.length === 1 && lower[0] === 'notifications')
      || (segments.length === 2 && lower[0] === 'notifications'
        && lower[1] === 'mentions')) return descriptor('notifications');

    const handle = segments.length > 0 ? canonicalHandle(segments[0]) : null;
    if (handle === null) return UNSUPPORTED;
    if (segments.length === 1) return descriptor('profile', handle, 'posts');
    if (segments.length === 2 && profileSections.has(lower[1])) {
      return descriptor('profile', handle, profileSections.get(lower[1]));
    }
    if ((segments.length === 3 || segments.length === 5) && lower[1] === 'status'
      && /^\d+$/.test(segments[2])) {
      if (segments.length === 5
        && (!['photo', 'video'].includes(lower[3]) || !/^[1-9]\d*$/.test(segments[4]))) {
        return UNSUPPORTED;
      }
      return descriptor('status', handle, null, segments[2]);
    }
    return UNSUPPORTED;
  }

  const ROUTE_KEYS = ['version', 'type', 'handle', 'profileSection', 'statusId'];
  const PROFILE_SECTIONS = new Set([
    'posts', 'replies', 'media', 'likes', 'highlights', 'articles',
  ]);
  const SOURCES = new Set(ACCOUNT_IDENTITY_SOURCES);
  const RESERVED_HANDLES = new Set(RESERVED_X_ROUTE_SEGMENTS);
  const EMPTY$4 = Object.freeze([]);
  const hasOwn$a = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function isPlainObject$6(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch {
      return false;
    }
  }

  function validateRoot$1(root) {
    let valid = false;
    try {
      valid = root !== null && typeof root === 'object' && !Array.isArray(root)
        && typeof root.querySelectorAll === 'function';
    } catch { /* Invalid facade roots use the public validation error. */ }
    if (!valid) throw new TypeError('Invalid account target route planning root');
  }

  function validateRoute(route) {
    if (!isPlainObject$6(route)) throw new TypeError('Invalid X route descriptor');
    let keys;
    let values;
    try {
      keys = Reflect.ownKeys(route);
      if (keys.length !== ROUTE_KEYS.length || keys.some((key) => typeof key !== 'string')
        || ROUTE_KEYS.some((key) => !hasOwn$a(route, key))) throw new Error('invalid');
      values = ROUTE_KEYS.map((key) => route[key]);
    } catch {
      throw new TypeError('Invalid X route descriptor');
    }
    const [version, type, handle, profileSection, statusId] = values;
    if (version !== 1 || typeof type !== 'string') {
      throw new TypeError('Invalid X route descriptor');
    }
    const emptyFields = handle === null && profileSection === null && statusId === null;
    if (['home', 'explore', 'search', 'notifications', 'unsupported'].includes(type)) {
      if (!emptyFields) throw new TypeError('Invalid X route descriptor');
    } else {
      let canonical = false;
      try {
        canonical = normalizeXHandle(handle) === handle && !RESERVED_HANDLES.has(handle);
      } catch { /* invalid */ }
      if (!canonical) throw new TypeError('Invalid X route descriptor');
      if (type === 'profile') {
        if (!PROFILE_SECTIONS.has(profileSection) || statusId !== null) {
          throw new TypeError('Invalid X route descriptor');
        }
      } else if (type === 'status') {
        if (profileSection !== null || typeof statusId !== 'string' || !/^\d+$/.test(statusId)) {
          throw new TypeError('Invalid X route descriptor');
        }
      } else {
        throw new TypeError('Invalid X route descriptor');
      }
    }
    return { type, profileSection };
  }

  function normalizeOptions$5(options) {
    if (!isPlainObject$6(options)) {
      throw new TypeError('account target route planner options must be a plain object');
    }
    try {
      const keys = Reflect.ownKeys(options);
      if (keys.length > 1 || keys.some((key) => key !== 'baseUrl')) throw new Error('invalid');
      if (!hasOwn$a(options, 'baseUrl')) return { hasBaseUrl: false };
      return { hasBaseUrl: true, baseUrl: options.baseUrl };
    } catch {
      throw new TypeError('Invalid account target route planner options');
    }
  }

  function sourcePolicy(type, profileSection) {
    if (type === 'home' || type === 'explore') return ['timeline'];
    if (type === 'profile') {
      return profileSection === 'replies' ? ['profile', 'reply'] : ['profile', 'timeline'];
    }
    if (type === 'status') return ['reply'];
    if (type === 'search') return ['search'];
    if (type === 'notifications') return ['notification'];
    return EMPTY$4;
  }

  /** Converts an explicit route and root into immutable session-group plans. */
  function createXAccountTargetSessionPlans(root, route, options = {}) {
    validateRoot$1(root);
    const canonicalRoute = validateRoute(route);
    const normalizedOptions = normalizeOptions$5(options);
    const sources = sourcePolicy(canonicalRoute.type, canonicalRoute.profileSection);
    if (sources === EMPTY$4) return EMPTY$4;
    return Object.freeze(sources.map((source) => {
      if (!SOURCES.has(source)) throw new TypeError('Invalid X route descriptor');
      const plan = { root, source };
      if (normalizedOptions.hasBaseUrl) plan.baseUrl = normalizedOptions.baseUrl;
      return Object.freeze(plan);
    }));
  }

  const hasOwn$9 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

  function validateLink(link) {
    if (
      link === null ||
      typeof link !== 'object' ||
      Array.isArray(link) ||
      typeof link.tagName !== 'string' ||
      link.tagName.toLowerCase() !== 'a' ||
      link.ownerDocument === null ||
      typeof link.ownerDocument !== 'object' ||
      typeof link.getAttribute !== 'function'
    ) {
      throw new TypeError('Invalid X account link');
    }
  }

  function validateOptions$1(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Invalid account link options');
    }
    if (hasOwn$9(options, 'accountId')) {
      throw new TypeError('accountId is not supported by the account link reader');
    }
  }

  function readRawHref(link) {
    try {
      const href = link.getAttribute('href');
      if (typeof href !== 'string' || href.trim() === '') return null;
      return href.trim();
    } catch {
      return null;
    }
  }

  function readBaseUrl(link, options) {
    try {
      return hasOwn$9(options, 'baseUrl') ? options.baseUrl : link.ownerDocument.baseURI;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads one explicitly supplied anchor without discovering or retaining DOM.
   */
  function readXAccountIdentityFromLink(link, options = {}) {
    validateLink(link);
    validateOptions$1(options);

    const reference = readRawHref(link);
    if (reference === null) return null;

    const rootRelative = reference.startsWith('/') && !reference.startsWith('//');
    const absoluteHttps = /^https:\/\//i.test(reference);
    if (!rootRelative && !absoluteHttps) return null;

    const parseOptions = rootRelative ? { baseUrl: readBaseUrl(link, options) } : undefined;
    const identity = parseXAccountReference(reference, parseOptions);
    if (identity === null) return null;

    // A direct handle makes the shared identity validator surface invalid source
    // values while still returning the existing canonical immutable value.
    return parseXAccountReference(identity.handle, { source: options.source });
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
  const COUNTRY_REGION_CODES = Object.freeze(
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

  function isSupportedCountryCode(value) {
    try {
      normalizeCountryCode(value);
      return true;
    } catch {
      return false;
    }
  }

  function getCountryRegionCode(value) {
    if (!isSupportedCountryCode(value)) return null;
    return COUNTRY_REGION_CODES[normalizeCountryCode(value)];
  }

  function getCountryRegion(value) {
    const regionCode = getCountryRegionCode(value);
    return regionCode === null ? null : REGIONS[regionCode];
  }

  const LOCATION_STATUSES = Object.freeze({
    KNOWN: 'known',
    HIDDEN: 'hidden',
    MISSING: 'missing',
    UNAVAILABLE: 'unavailable',
    UNKNOWN: 'unknown',
  });

  const validStatuses = new Set(Object.values(LOCATION_STATUSES));

  function optionalText(value, field) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw new TypeError(`${field} must be a string or null`);
    return value;
  }

  /**
   * Creates the complete, immutable, deliberately minimal location-result value.
   * Only the seven documented properties are copied, preventing request/account
   * metadata supplied alongside them from leaking into the domain result.
   */
  function createLocationResult(input = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('location input must be an object');
    }

    const status = input.status;
    if (!validStatuses.has(status)) {
      throw new TypeError(`Unsupported location status: ${String(status)}`);
    }

    const rawLocation = optionalText(input.rawLocation, 'rawLocation');
    const source = optionalText(input.source, 'source');
    let countryCode = null;
    let countryName = null;
    let regionCode = null;
    let regionName = null;

    if (status === LOCATION_STATUSES.KNOWN) {
      countryCode = normalizeCountryCode(input.countryCode);
      if (typeof input.countryName !== 'string' || input.countryName.trim() === '') {
        throw new TypeError('A known location requires a countryName');
      }
      countryName = input.countryName;

      const region = getCountryRegion(countryCode);
      if (region.code === REGION_CODES.UNKNOWN) {
        if (input.regionCode != null || input.regionName != null) {
          throw new TypeError('This country does not support a region assertion');
        }
      } else {
        if (input.regionCode != null && getRegion(input.regionCode)?.code !== region.code) {
          throw new TypeError('regionCode must match the country region');
        }
        if (input.regionName != null && input.regionName !== region.name) {
          throw new TypeError('regionName must match the country region');
        }
        regionCode = region.code;
        regionName = region.name;
      }
    }

    return Object.freeze({
      status,
      countryCode,
      countryName,
      regionCode,
      regionName,
      rawLocation,
      source,
    });
  }

  const createKnownLocation = (input) => createLocationResult({ ...input, status: 'known' });
  const createMissingLocation = (input = {}) => createLocationResult({ ...input, status: 'missing' });
  const createUnavailableLocation = (input = {}) =>
    createLocationResult({ ...input, status: 'unavailable' });
  const createUnknownLocation = (input = {}) => createLocationResult({ ...input, status: 'unknown' });

  const FILTER_ACTIONS = Object.freeze({ SHOW: 'show', HIGHLIGHT: 'highlight', HIDE: 'hide' });

  const categories = ['country', 'region', 'other'];

  function rules(value, label) {
    if (value == null) return [];
    if (!Array.isArray(value) && !(value instanceof Set)) {
      throw new TypeError(`${label} must be an array or Set`);
    }
    return value;
  }

  function category$1(settings, name) {
    const value = settings[name];
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value) || value instanceof Set) {
      throw new TypeError(`${name} settings must be an object`);
    }
    return value;
  }

  function includes(collection, candidate, normalize = (value) => value) {
    if (candidate == null) return false;
    const wanted = normalize(candidate);
    return Array.from(collection).some((value) => typeof value === 'string' && normalize(value) === wanted);
  }

  const upper = (value) => value.toUpperCase();
  const lower = (value) => value.toLowerCase();

  /**
   * Purely decides presentation for a subject. Malformed settings throw TypeError
   * rather than silently applying a potentially unsafe rule. Missing categories
   * and rule lists are empty. Supported schema:
   * country/region: { hide, highlight, alwaysShow };
   * other: { hide, highlight } (location statuses); allowlist: Array|Set.
   */
  function decideFilterAction(subject = {}, settings = {}) {
    if (subject === null || typeof subject !== 'object' || Array.isArray(subject)) {
      throw new TypeError('subject must be an object');
    }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('settings must be an object');
    }

    const configured = Object.fromEntries(categories.map((name) => [name, category$1(settings, name)]));
    const allowlist = rules(settings.allowlist, 'allowlist');
    const location = subject.location;
    const known = location?.status === LOCATION_STATUSES.KNOWN;
    const country = known ? location.countryCode : null;
    const region = known ? location.regionCode : null;

    if (includes(allowlist, subject.allowlistKey)) return FILTER_ACTIONS.SHOW;
    if (includes(rules(configured.country.alwaysShow, 'country.alwaysShow'), country, upper)) {
      return FILTER_ACTIONS.SHOW;
    }
    if (includes(rules(configured.country.hide, 'country.hide'), country, upper)) {
      return FILTER_ACTIONS.HIDE;
    }
    if (includes(rules(configured.region.hide, 'region.hide'), region, upper)) {
      return FILTER_ACTIONS.HIDE;
    }
    if (!known && includes(rules(configured.other.hide, 'other.hide'), location?.status, lower)) {
      return FILTER_ACTIONS.HIDE;
    }

    const highlighted =
      includes(rules(configured.country.highlight, 'country.highlight'), country, upper) ||
      includes(rules(configured.region.highlight, 'region.highlight'), region, upper) ||
      (!known && includes(rules(configured.other.highlight, 'other.highlight'), location?.status, lower));

    return highlighted ? FILTER_ACTIONS.HIGHLIGHT : FILTER_ACTIONS.SHOW;
  }

  const ACCOUNT_ACTION_ATTRIBUTE = 'data-x-region-block-account-action';

  function validateContainer$1(container) {
    if (container === null || typeof container !== 'object' || Array.isArray(container)
      || typeof container.getAttribute !== 'function'
      || typeof container.setAttribute !== 'function'
      || typeof container.removeAttribute !== 'function') {
      throw new TypeError('Invalid account action container');
    }
  }

  function validateAction(action) {
    if (action !== FILTER_ACTIONS.SHOW && action !== FILTER_ACTIONS.HIGHLIGHT
      && action !== FILTER_ACTIONS.HIDE) {
      throw new TypeError('Invalid account filter action');
    }
  }

  function applyAccountAction(container, action) {
    validateContainer$1(container);
    validateAction(action);
    if (action === FILTER_ACTIONS.SHOW) removeAccountAction(container);
    else container.setAttribute(ACCOUNT_ACTION_ATTRIBUTE, action);
    return action;
  }

  function removeAccountAction(container) {
    validateContainer$1(container);
    const value = container.getAttribute(ACCOUNT_ACTION_ATTRIBUTE);
    if (value !== FILTER_ACTIONS.HIGHLIGHT && value !== FILTER_ACTIONS.HIDE) return 0;
    container.removeAttribute(ACCOUNT_ACTION_ATTRIBUTE);
    return 1;
  }

  function isPlainObject$5(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  /** Creates the minimal, deeply immutable input accepted by the filter engine. */
  function createFilterSubject(input) {
    if (!isPlainObject$5(input)) throw new TypeError('filter subject input must be a plain object');
    if (!isPlainObject$5(input.identity)) throw new TypeError('identity must be a plain object');
    if (!isPlainObject$5(input.location)) throw new TypeError('location must be a plain object');

    const identity = createAccountIdentity(input.identity);
    const location = createLocationResult(input.location);
    return Object.freeze({
      identity,
      allowlistKey: identity.allowlistKey,
      location,
    });
  }

  /** Canonicalizes a subject and purely evaluates it against the supplied settings. */
  function evaluateFilterSubject(input, settings) {
    const subject = createFilterSubject(input);
    const action = decideFilterAction(subject, settings);
    return Object.freeze({ subject, action });
  }

  const LOCATION_DISPLAY_MODEL_VERSION = 1;
  const LOCATION_GLOBE_SYMBOL = '🌐';

  const LOCATION_STATUS_LABELS = Object.freeze({
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
  function createLocationDisplayModel(input) {
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

  const ACCOUNT_EVALUATION_VERSION = 1;

  const hasOwn$8 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

  function isPlainObject$4(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  /**
   * Canonicalizes and evaluates one explicitly supplied account link and observation.
   * This boundary deliberately performs no discovery, rendering, lookup, or page mutation.
   */
  function evaluateXAccountLink(link, observation, settings) {
    if (!isPlainObject$4(observation)) {
      throw new TypeError('account observation must be a plain object');
    }
    if (hasOwn$8(observation, 'accountId')) {
      throw new TypeError('accountId is not supported by account evaluation');
    }

    const readerOptions = Object.create(null);
    if (hasOwn$8(observation, 'source')) readerOptions.source = observation.source;
    if (hasOwn$8(observation, 'baseUrl')) readerOptions.baseUrl = observation.baseUrl;

    const identity = readXAccountIdentityFromLink(link, readerOptions);
    if (identity === null) return null;

    if (!hasOwn$8(observation, 'location')) {
      throw new TypeError('account observation location is required');
    }
    const evaluation = evaluateFilterSubject({ identity, location: observation.location }, settings);
    const display = createLocationDisplayModel(evaluation.subject.location);
    return Object.freeze({
      version: ACCOUNT_EVALUATION_VERSION,
      subject: evaluation.subject,
      action: evaluation.action,
      display,
    });
  }

  const LOCATION_BADGE_ATTRIBUTE = 'data-x-region-block-location-badge';
  const LOCATION_BADGE_ATTRIBUTE_VALUE = '1';

  const LOCATION_BADGE_CLASSES = Object.freeze({
    root: 'x-region-block-location-badge',
    country: 'x-region-block-location-country',
    countryFlag: 'x-region-block-location-country-flag',
    separator: 'x-region-block-location-separator',
    region: 'x-region-block-location-region',
  });

  const STATUS_ATTRIBUTE = 'data-x-region-block-status';
  const COUNTRY_CODE_ATTRIBUTE = 'data-x-region-block-country-code';
  const REGION_CODE_ATTRIBUTE = 'data-x-region-block-region-code';

  function validateContainer(container) {
    if (
      container === null
      || typeof container !== 'object'
      || Array.isArray(container)
      || container.ownerDocument === null
      || typeof container.ownerDocument !== 'object'
      || typeof container.ownerDocument.createElement !== 'function'
      || typeof container.appendChild !== 'function'
      || typeof container.removeChild !== 'function'
      || container.children === null
      || (typeof container.children !== 'object' && typeof container.children !== 'function')
      || typeof container.children[Symbol.iterator] !== 'function'
    ) {
      throw new TypeError('Invalid location badge container');
    }
  }

  function ownedChildren(container) {
    return [...container.children].filter(
      (child) => typeof child?.getAttribute === 'function'
        && child.getAttribute(LOCATION_BADGE_ATTRIBUTE) === LOCATION_BADGE_ATTRIBUTE_VALUE,
    );
  }

  function findLocationBadge(container) {
    validateContainer(container);
    return ownedChildren(container)[0] ?? null;
  }

  function setCommonChildAttributes(element, className, title) {
    element.setAttribute('class', className);
    element.setAttribute('aria-hidden', 'true');
    if (title !== null) element.setAttribute('title', title);
  }

  function createRegionElement(ownerDocument, region) {
    const element = ownerDocument.createElement('span');
    setCommonChildAttributes(element, LOCATION_BADGE_CLASSES.region, region.title);
    if (region.code !== null) element.setAttribute(REGION_CODE_ATTRIBUTE, region.code);
    element.textContent = `${region.symbol} ${region.label}`;
    return element;
  }

  function createCountryElement(ownerDocument, country, resolveFlagAssetUrl) {
    const wrapper = ownerDocument.createElement('span');
    setCommonChildAttributes(wrapper, LOCATION_BADGE_CLASSES.country, country.title);
    wrapper.setAttribute(COUNTRY_CODE_ATTRIBUTE, country.code);
    let failed = false;
    const fallback = () => {
      if (failed) return;
      failed = true;
      wrapper.textContent = country.code;
    };
    try {
      if (typeof resolveFlagAssetUrl !== 'function') throw new TypeError();
      const url = resolveFlagAssetUrl(country.code);
      const expectedPath = `/assets/flags/${country.code.toLowerCase()}.png`;
      if (typeof url !== 'string'
        || !/^(?:chrome|moz)-extension:\/\/[^/]+\/assets\/flags\/[a-z]{2}\.png$/.test(url)
        || !url.endsWith(expectedPath)) throw new TypeError();
      const image = ownerDocument.createElement('img');
      image.setAttribute('class', LOCATION_BADGE_CLASSES.countryFlag);
      image.setAttribute('src', url);
      image.setAttribute('alt', '');
      image.setAttribute('aria-hidden', 'true');
      image.setAttribute('draggable', 'false');
      image.setAttribute('tabindex', '-1');
      image.setAttribute('contenteditable', 'false');
      image.addEventListener('error', fallback, { once: true });
      wrapper.appendChild(image);
    } catch { fallback(); }
    return wrapper;
  }

  function renderLocationBadge(container, location, resolveFlagAssetUrl) {
    validateContainer(container);
    const display = createLocationDisplayModel(location);
    const existing = ownedChildren(container);
    let root = existing[0] ?? null;

    if (root !== null && String(root.tagName).toLowerCase() !== 'span') {
      container.removeChild(root);
      root = null;
    }
    for (const duplicate of existing) {
      if (duplicate !== root && duplicate.parentNode === container) container.removeChild(duplicate);
    }
    if (root === null) {
      root = container.ownerDocument.createElement('span');
      root.setAttribute(LOCATION_BADGE_ATTRIBUTE, LOCATION_BADGE_ATTRIBUTE_VALUE);
      container.appendChild(root);
    }

    root.textContent = '';
    root.setAttribute('class', LOCATION_BADGE_CLASSES.root);
    root.setAttribute(LOCATION_BADGE_ATTRIBUTE, LOCATION_BADGE_ATTRIBUTE_VALUE);
    root.setAttribute(STATUS_ATTRIBUTE, display.status);
    root.setAttribute('role', 'group');
    root.removeAttribute(COUNTRY_CODE_ATTRIBUTE);
    root.removeAttribute(REGION_CODE_ATTRIBUTE);
    root.removeAttribute('aria-hidden');
    root.removeAttribute('tabindex');
    root.removeAttribute('contenteditable');

    if (display.country !== null) {
      const country = createCountryElement(container.ownerDocument, display.country, resolveFlagAssetUrl);

      const separator = container.ownerDocument.createElement('span');
      setCommonChildAttributes(separator, LOCATION_BADGE_CLASSES.separator, null);
      separator.textContent = ' ';

      root.setAttribute('aria-label', `${display.country.ariaLabel}; ${display.region.ariaLabel}`);
      root.setAttribute('title', `${display.country.title} · ${display.region.title}`);
      root.appendChild(country);
      root.appendChild(separator);
    } else {
      root.setAttribute('aria-label', display.region.ariaLabel);
      root.setAttribute('title', display.region.title);
    }

    root.appendChild(createRegionElement(container.ownerDocument, display.region));
    return root;
  }

  function removeLocationBadge(container) {
    validateContainer(container);
    const owned = ownedChildren(container);
    for (const root of owned) container.removeChild(root);
    return owned.length;
  }

  /**
   * Evaluates and presents one explicitly supplied account link without page discovery.
   */
  function presentXAccountLink(link, badgeContainer, observation, settings, resolveFlagAssetUrl) {
    findLocationBadge(badgeContainer);
    const evaluation = evaluateXAccountLink(link, observation, settings);

    if (evaluation === null) {
      removeLocationBadge(badgeContainer);
      return null;
    }

    renderLocationBadge(badgeContainer, evaluation.subject.location, resolveFlagAssetUrl);
    return evaluation;
  }

  const ACCOUNT_TARGET_DISCOVERY_VERSION = 1;

  const X_ACCOUNT_DISCOVERY_SELECTORS = Object.freeze({
    surfaces: Object.freeze({
      profile: '[data-testid="UserName"]',
      timeline: 'article[data-testid="tweet"]',
      reply: 'article[data-testid="tweet"]',
      search: '[data-testid="UserCell"]',
      notification: '[data-testid="UserCell"]',
    }),
    nameContainer: '[data-testid="User-Name"], [data-testid="UserName"]',
    accountLink: 'a[href]',
  });

  const hasOwn$7 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

  function validateRoot(root) {
    if (root === null || typeof root !== 'object' || Array.isArray(root)
      || typeof root.querySelectorAll !== 'function') {
      throw new TypeError('Invalid account discovery root');
    }
  }

  function normalizeOptions$4(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('account discovery options must be a plain object');
    }
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('account discovery options must be a plain object');
    }
    if (hasOwn$7(options, 'accountId')) {
      throw new TypeError('accountId is not supported by account discovery');
    }
    if (!hasOwn$7(options, 'source') || typeof options.source !== 'string') {
      throw new TypeError('Invalid account discovery source');
    }
    const source = options.source.trim().toLowerCase();
    if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
      throw new TypeError('Invalid account discovery source');
    }
    return { source, hasBaseUrl: hasOwn$7(options, 'baseUrl'), baseUrl: options.baseUrl };
  }

  function attribute(element, name) {
    return element !== null && typeof element === 'object'
      && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
  }

  function isSurfaceForSource(element, source) {
    const testId = attribute(element, 'data-testid');
    if (source === 'profile') return testId === 'UserName';
    if (source === 'search' || source === 'notification') return testId === 'UserCell';
    return typeof element?.tagName === 'string' && element.tagName.toLowerCase() === 'article'
      && testId === 'tweet';
  }

  function isNestedBoundary(element) {
    const testId = attribute(element, 'data-testid');
    return testId === 'UserCell'
      || (typeof element?.tagName === 'string' && element.tagName.toLowerCase() === 'article'
        && testId === 'tweet');
  }

  function isLocalContainer(container, surface) {
    let ancestor = container?.parentElement;
    while (ancestor && ancestor !== surface) {
      if (isNestedBoundary(ancestor)) return false;
      ancestor = ancestor.parentElement;
    }
    return ancestor === surface;
  }

  function isAnchorLike(link) {
    try {
      return link !== null && typeof link === 'object' && typeof link.tagName === 'string'
        && link.tagName.toLowerCase() === 'a' && link.ownerDocument !== null
        && typeof link.ownerDocument === 'object' && typeof link.getAttribute === 'function';
    } catch {
      return false;
    }
  }

  const AMBIGUOUS = Symbol('ambiguous account target');

  function resolveContainer(container, normalized) {
    if (container === null || typeof container !== 'object'
      || typeof container.querySelectorAll !== 'function') return null;
    const links = container.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.accountLink);
    if (links === null || typeof links?.[Symbol.iterator] !== 'function') return null;
    let selected = null;
    for (const link of links) {
      if (!isAnchorLike(link)) continue;
      const readerOptions = normalized.hasBaseUrl
        ? { source: normalized.source, baseUrl: normalized.baseUrl }
        : { source: normalized.source };
      const identity = readXAccountIdentityFromLink(link, readerOptions);
      if (identity === null) continue;
      if (selected !== null && selected.identity.allowlistKey !== identity.allowlistKey) {
        return AMBIGUOUS;
      }
      if (selected === null) selected = { link, identity };
    }
    return selected;
  }

  function resolveSurface(surface, normalized) {
    let containers;
    if (normalized.source === 'profile') containers = [surface];
    else {
      if (surface === null || typeof surface !== 'object'
        || typeof surface.querySelectorAll !== 'function') return null;
      const queried = surface.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.nameContainer);
      if (queried === null || typeof queried?.[Symbol.iterator] !== 'function') return null;
      containers = [...queried].filter((container) => isLocalContainer(container, surface));
    }
    let selected = null;
    for (const badgeContainer of containers) {
      const resolved = resolveContainer(badgeContainer, normalized);
      if (resolved === AMBIGUOUS) return null;
      if (resolved === null) continue;
      if (selected !== null
        && selected.identity.allowlistKey !== resolved.identity.allowlistKey) return null;
      if (selected === null) selected = { badgeContainer, ...resolved };
    }
    return selected;
  }

  /** Discovers account presentation targets in one explicitly supplied static root. */
  function discoverXAccountPresentationTargets(root, options) {
    validateRoot(root);
    const normalized = normalizeOptions$4(options);
    const queried = root.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.surfaces[normalized.source]);
    if (queried === null || typeof queried?.[Symbol.iterator] !== 'function') {
      throw new TypeError('Invalid account discovery root');
    }
    const surfaces = [];
    const seenSurfaces = new Set();
    const addSurface = (surface) => {
      if (!seenSurfaces.has(surface)) {
        seenSurfaces.add(surface);
        surfaces.push(surface);
      }
    };
    if (isSurfaceForSource(root, normalized.source)) addSurface(root);
    for (const surface of queried) addSurface(surface);

    const targets = [];
    for (const accountContainer of surfaces) {
      if (!isSurfaceForSource(accountContainer, normalized.source)) continue;
      const resolved = resolveSurface(accountContainer, normalized);
      if (resolved === null) continue;
      targets.push(Object.freeze({
        version: ACCOUNT_TARGET_DISCOVERY_VERSION,
        source: normalized.source,
        accountContainer,
        link: resolved.link,
        badgeContainer: resolved.badgeContainer,
        identity: resolved.identity,
      }));
    }
    return Object.freeze(targets);
  }

  const ACCOUNT_TARGET_OBSERVER_VERSION = 1;

  const EMPTY$3 = Object.freeze([]);
  const hasOwn$6 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

  function normalizeOptions$3(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || (Object.getPrototypeOf(options) !== Object.prototype
        && Object.getPrototypeOf(options) !== null)) {
      throw new TypeError('account target observer options must be a plain object');
    }
    if (hasOwn$6(options, 'accountId')) {
      throw new TypeError('accountId is not supported by account target observation');
    }
    if (!hasOwn$6(options, 'source') || typeof options.source !== 'string') {
      throw new TypeError('Invalid account target observer source');
    }
    const source = options.source.trim().toLowerCase();
    if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
      throw new TypeError('Invalid account target observer source');
    }
    if (!hasOwn$6(options, 'observerFactory') || typeof options.observerFactory !== 'function') {
      throw new TypeError('observerFactory must be a function');
    }
    if (!hasOwn$6(options, 'onChange') || typeof options.onChange !== 'function') {
      throw new TypeError('onChange must be a function');
    }
    if (!hasOwn$6(options, 'onError') || typeof options.onError !== 'function') {
      throw new TypeError('onError must be a function');
    }
    return {
      source,
      hasBaseUrl: hasOwn$6(options, 'baseUrl'),
      baseUrl: options.baseUrl,
      observerFactory: options.observerFactory,
      onChange: options.onChange,
      onError: options.onError,
    };
  }

  function equivalent(previous, current) {
    return previous.version === current.version && previous.source === current.source
      && previous.link === current.link && previous.badgeContainer === current.badgeContainer
      && previous.identity.handle === current.identity.handle
      && previous.identity.displayHandle === current.identity.displayHandle
      && previous.identity.profileUrl === current.identity.profileUrl
      && previous.identity.accountId === current.identity.accountId
      && previous.identity.allowlistKey === current.identity.allowlistKey
      && previous.identity.source === current.identity.source;
  }

  /** Creates an isolated lifecycle around static X account-target discovery. */
  function createXAccountTargetObserver(root, options) {
    if (root === null || typeof root !== 'object' || Array.isArray(root)
      || typeof root.querySelectorAll !== 'function') {
      throw new TypeError('Invalid account target observer root');
    }
    const normalized = normalizeOptions$3(options);
    let activeRoot = null;
    let observer = null;
    let active = false;
    let targets = EMPTY$3;
    let generation = 0;
    let scheduled = false;

    const report = (error) => {
      try { normalized.onError(error); } catch { /* The error boundary is intentionally silent. */ }
    };
    const deliver = (change) => {
      try { normalized.onChange(change); } catch {
        report(new Error('Unable to deliver account target changes'));
      }
    };
    const scan = () => discoverXAccountPresentationTargets(activeRoot,
      normalized.hasBaseUrl
        ? { source: normalized.source, baseUrl: normalized.baseUrl }
        : { source: normalized.source });

    const reconcile = (discovered, reason, initial = false) => {
      const previousByContainer = new Map(targets.map((target) => [target.accountContainer, target]));
      const current = [];
      const added = [];
      const updated = [];
      for (const discoveredTarget of discovered) {
        const previous = previousByContainer.get(discoveredTarget.accountContainer);
        if (previous === undefined) {
          current.push(discoveredTarget);
          added.push(discoveredTarget);
        } else {
          previousByContainer.delete(discoveredTarget.accountContainer);
          if (equivalent(previous, discoveredTarget)) current.push(previous);
          else {
            current.push(discoveredTarget);
            updated.push(Object.freeze({ previous, current: discoveredTarget }));
          }
        }
      }
      const removed = [...previousByContainer.values()];
      const orderChanged = current.length !== targets.length
        || current.some((target, index) => target !== targets[index]);
      if (!initial && added.length === 0 && updated.length === 0 && removed.length === 0
        && !orderChanged) return targets;
      targets = Object.freeze(current);
      deliver(Object.freeze({
        version: ACCOUNT_TARGET_OBSERVER_VERSION,
        reason,
        source: normalized.source,
        current: targets,
        added: Object.freeze(added),
        updated: Object.freeze(updated),
        removed: Object.freeze(removed),
      }));
      return targets;
    };

    const handleMutations = (records) => {
      if (!active || records == null || records.length === 0 || scheduled) return;
      scheduled = true;
      const scheduledGeneration = generation;
      Promise.resolve().then(() => {
        if (!active || generation !== scheduledGeneration) return;
        scheduled = false;
        try { reconcile(scan(), 'mutation'); } catch {
          report(new Error('Unable to refresh account targets'));
        }
      });
    };

    const start = () => {
      if (active) return targets;
      let created;
      try {
        created = normalized.observerFactory(handleMutations);
        if (created === null || typeof created !== 'object'
          || typeof created.observe !== 'function' || typeof created.disconnect !== 'function') {
          throw new TypeError('observerFactory returned an invalid observer');
        }
        activeRoot = root;
        observer = created;
        active = true;
        generation += 1;
        created.observe(activeRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-testid', 'href'],
        });
        return reconcile(scan(), 'initial', true);
      } catch (error) {
        if (created && typeof created.disconnect === 'function') {
          try { created.disconnect(); } catch { /* Preserve the initialization error. */ }
        }
        active = false;
        activeRoot = null;
        observer = null;
        targets = EMPTY$3;
        scheduled = false;
        generation += 1;
        throw error;
      }
    };
    const stop = () => {
      if (!active) return;
      const currentObserver = observer;
      active = false;
      generation += 1;
      scheduled = false;
      targets = EMPTY$3;
      activeRoot = null;
      observer = null;
      currentObserver.disconnect();
    };
    const rescan = () => {
      if (!active) throw new TypeError('account target observer is not active');
      return reconcile(scan(), 'manual');
    };
    const getTargets = () => targets;
    const isActive = () => active;
    return Object.freeze({ start, stop, rescan, getTargets, isActive });
  }

  const SETTINGS_SCHEMA_VERSION = 2;

  const OTHER_STATUSES = new Set(['hidden', 'missing', 'unavailable', 'unknown']);

  function isPlainObject$3(value) {
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
    if (!isPlainObject$3(input[name])) throw new TypeError(`${name} must be a plain object`);
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
    if (!isPlainObject$3(input)) throw new TypeError('settings must be a plain object');

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
    if (!isPlainObject$3(input)) throw new TypeError('settings must be a plain object');

    const version = 'schemaVersion' in input ? input.schemaVersion : 0;
    if (!Number.isInteger(version)) throw new TypeError('schemaVersion must be an integer');
    if (version < 0 || version > SETTINGS_SCHEMA_VERSION) {
      throw new RangeError(`unsupported settings schema version: ${version}`);
    }
    return normalizeSettings(input);
  }

  /** Static English display names, ordered exactly like the supported country registry. */
  const COUNTRY_NAMES_BY_CODE = Object.freeze({
    AD: "Andorra",
    AE: "United Arab Emirates",
    AF: "Afghanistan",
    AG: "Antigua & Barbuda",
    AI: "Anguilla",
    AL: "Albania",
    AM: "Armenia",
    AO: "Angola",
    AQ: "Antarctica",
    AR: "Argentina",
    AS: "American Samoa",
    AT: "Austria",
    AU: "Australia",
    AW: "Aruba",
    AX: "Åland Islands",
    AZ: "Azerbaijan",
    BA: "Bosnia & Herzegovina",
    BB: "Barbados",
    BD: "Bangladesh",
    BE: "Belgium",
    BF: "Burkina Faso",
    BG: "Bulgaria",
    BH: "Bahrain",
    BI: "Burundi",
    BJ: "Benin",
    BL: "St. Barthélemy",
    BM: "Bermuda",
    BN: "Brunei",
    BO: "Bolivia",
    BQ: "Caribbean Netherlands",
    BR: "Brazil",
    BS: "Bahamas",
    BT: "Bhutan",
    BV: "Bouvet Island",
    BW: "Botswana",
    BY: "Belarus",
    BZ: "Belize",
    CA: "Canada",
    CC: "Cocos (Keeling) Islands",
    CD: "Democratic Republic of the Congo",
    CF: "Central African Republic",
    CG: "Republic of the Congo",
    CH: "Switzerland",
    CI: "Côte d’Ivoire",
    CK: "Cook Islands",
    CL: "Chile",
    CM: "Cameroon",
    CN: "China",
    CO: "Colombia",
    CR: "Costa Rica",
    CU: "Cuba",
    CV: "Cabo Verde",
    CW: "Curaçao",
    CX: "Christmas Island",
    CY: "Cyprus",
    CZ: "Czechia",
    DE: "Germany",
    DJ: "Djibouti",
    DK: "Denmark",
    DM: "Dominica",
    DO: "Dominican Republic",
    DZ: "Algeria",
    EC: "Ecuador",
    EE: "Estonia",
    EG: "Egypt",
    EH: "Western Sahara",
    ER: "Eritrea",
    ES: "Spain",
    ET: "Ethiopia",
    FI: "Finland",
    FJ: "Fiji",
    FK: "Falkland Islands",
    FM: "Micronesia",
    FO: "Faroe Islands",
    FR: "France",
    GA: "Gabon",
    GB: "United Kingdom",
    GD: "Grenada",
    GE: "Georgia",
    GF: "French Guiana",
    GG: "Guernsey",
    GH: "Ghana",
    GI: "Gibraltar",
    GL: "Greenland",
    GM: "Gambia",
    GN: "Guinea",
    GP: "Guadeloupe",
    GQ: "Equatorial Guinea",
    GR: "Greece",
    GS: "South Georgia and the South Sandwich Islands",
    GT: "Guatemala",
    GU: "Guam",
    GW: "Guinea-Bissau",
    GY: "Guyana",
    HK: "Hong Kong",
    HM: "Heard & McDonald Islands",
    HN: "Honduras",
    HR: "Croatia",
    HT: "Haiti",
    HU: "Hungary",
    ID: "Indonesia",
    IE: "Ireland",
    IL: "Israel",
    IM: "Isle of Man",
    IN: "India",
    IO: "British Indian Ocean Territory",
    IQ: "Iraq",
    IR: "Iran",
    IS: "Iceland",
    IT: "Italy",
    JE: "Jersey",
    JM: "Jamaica",
    JO: "Jordan",
    JP: "Japan",
    KE: "Kenya",
    KG: "Kyrgyzstan",
    KH: "Cambodia",
    KI: "Kiribati",
    KM: "Comoros",
    KN: "St. Kitts & Nevis",
    KP: "North Korea",
    KR: "South Korea",
    KW: "Kuwait",
    KY: "Cayman Islands",
    KZ: "Kazakhstan",
    LA: "Laos",
    LB: "Lebanon",
    LC: "St. Lucia",
    LI: "Liechtenstein",
    LK: "Sri Lanka",
    LR: "Liberia",
    LS: "Lesotho",
    LT: "Lithuania",
    LU: "Luxembourg",
    LV: "Latvia",
    LY: "Libya",
    MA: "Morocco",
    MC: "Monaco",
    MD: "Moldova",
    ME: "Montenegro",
    MF: "Saint Martin (French part)",
    MG: "Madagascar",
    MH: "Marshall Islands",
    MK: "North Macedonia",
    ML: "Mali",
    MM: "Myanmar (Burma)",
    MN: "Mongolia",
    MO: "Macao",
    MP: "Northern Mariana Islands",
    MQ: "Martinique",
    MR: "Mauritania",
    MS: "Montserrat",
    MT: "Malta",
    MU: "Mauritius",
    MV: "Maldives",
    MW: "Malawi",
    MX: "Mexico",
    MY: "Malaysia",
    MZ: "Mozambique",
    NA: "Namibia",
    NC: "New Caledonia",
    NE: "Niger",
    NF: "Norfolk Island",
    NG: "Nigeria",
    NI: "Nicaragua",
    NL: "Netherlands",
    NO: "Norway",
    NP: "Nepal",
    NR: "Nauru",
    NU: "Niue",
    NZ: "New Zealand",
    OM: "Oman",
    PA: "Panama",
    PE: "Peru",
    PF: "French Polynesia",
    PG: "Papua New Guinea",
    PH: "Philippines",
    PK: "Pakistan",
    PL: "Poland",
    PM: "St. Pierre & Miquelon",
    PN: "Pitcairn Islands",
    PR: "Puerto Rico",
    PS: "Palestine",
    PT: "Portugal",
    PW: "Palau",
    PY: "Paraguay",
    QA: "Qatar",
    RE: "Réunion",
    RO: "Romania",
    RS: "Serbia",
    RU: "Russia",
    RW: "Rwanda",
    SA: "Saudi Arabia",
    SB: "Solomon Islands",
    SC: "Seychelles",
    SD: "Sudan",
    SE: "Sweden",
    SG: "Singapore",
    SH: "Saint Helena, Ascension and Tristan da Cunha",
    SI: "Slovenia",
    SJ: "Svalbard and Jan Mayen",
    SK: "Slovakia",
    SL: "Sierra Leone",
    SM: "San Marino",
    SN: "Senegal",
    SO: "Somalia",
    SR: "Suriname",
    SS: "South Sudan",
    ST: "São Tomé & Príncipe",
    SV: "El Salvador",
    SX: "Sint Maarten",
    SY: "Syria",
    SZ: "Eswatini",
    TC: "Turks & Caicos Islands",
    TD: "Chad",
    TF: "French Southern Territories",
    TG: "Togo",
    TH: "Thailand",
    TJ: "Tajikistan",
    TK: "Tokelau",
    TL: "Timor-Leste",
    TM: "Turkmenistan",
    TN: "Tunisia",
    TO: "Tonga",
    TR: "Türkiye",
    TT: "Trinidad & Tobago",
    TV: "Tuvalu",
    TW: "Taiwan",
    TZ: "Tanzania",
    UA: "Ukraine",
    UG: "Uganda",
    UM: "United States Minor Outlying Islands",
    US: "United States",
    UY: "Uruguay",
    UZ: "Uzbekistan",
    VA: "Vatican City",
    VC: "St. Vincent & Grenadines",
    VE: "Venezuela",
    VG: "British Virgin Islands",
    VI: "U.S. Virgin Islands",
    VN: "Vietnam",
    VU: "Vanuatu",
    WF: "Wallis & Futuna",
    WS: "Samoa",
    YE: "Yemen",
    YT: "Mayotte",
    ZA: "South Africa",
    ZM: "Zambia",
    ZW: "Zimbabwe",
  });

  /** Deliberate, unambiguous English alternatives to the canonical short names. */
  const COUNTRY_NAME_ALIASES = Object.freeze({
    'United States of America': 'US',
    USA: 'US',
    'Great Britain': 'GB',
    Britain: 'GB',
    'Republic of Korea': 'KR',
    'Korea, Republic of': 'KR',
    'Democratic People’s Republic of Korea': 'KP',
    'Korea, Democratic People’s Republic of': 'KP',
    'Russian Federation': 'RU',
    Turkey: 'TR',
    'Viet Nam': 'VN',
    'Iran, Islamic Republic of': 'IR',
    'Syrian Arab Republic': 'SY',
    'Bolivia, Plurinational State of': 'BO',
    'Venezuela, Bolivarian Republic of': 'VE',
    'Tanzania, United Republic of': 'TZ',
    'Moldova, Republic of': 'MD',
    'Lao People’s Democratic Republic': 'LA',
    'Brunei Darussalam': 'BN',
    'Czech Republic': 'CZ',
    'Ivory Coast': 'CI',
    "Cote d'Ivoire": 'CI',
    "Côte d'Ivoire": 'CI',
    'Cape Verde': 'CV',
    Swaziland: 'SZ',
    'East Timor': 'TL',
    'State of Palestine': 'PS',
    'Palestinian Territories': 'PS',
    'Taiwan, Province of China': 'TW',
    'Hong Kong SAR China': 'HK',
    Macau: 'MO',
    'Macao SAR China': 'MO',
    'The Bahamas': 'BS',
    'The Gambia': 'GM',
    'Federated States of Micronesia': 'FM',
    'Congo-Kinshasa': 'CD',
    'DR Congo': 'CD',
    'Congo-Brazzaville': 'CG',
    'Saint Barthélemy': 'BL',
    'Sint Maarten (Dutch part)': 'SX',
    'United States Virgin Islands': 'VI',
    'Holy See': 'VA',
    'Cocos Islands': 'CC',
  });

  const apostrophes = /[‘’‛]/gu;
  const dashes = /[‐‑‒–—―−]/gu;

  function normalizeCountryName(value) {
    if (typeof value !== 'string') throw new TypeError('country name must be a string');
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
      .replace(apostrophes, '’').replace(dashes, '-').toLowerCase();
  }

  const countryCodesByNormalizedName = new Map();
  function registerName(name, code) {
    const normalized = normalizeCountryName(name);
    const existing = countryCodesByNormalizedName.get(normalized);
    if (existing !== undefined && existing !== code) {
      throw new TypeError(`Conflicting country name: ${name}`);
    }
    countryCodesByNormalizedName.set(normalized, code);
  }
  for (const code of COUNTRY_CODES) registerName(COUNTRY_NAMES_BY_CODE[code], code);
  for (const [name, code] of Object.entries(COUNTRY_NAME_ALIASES)) registerName(name, code);

  function getCountryName(countryCode) {
    return COUNTRY_NAMES_BY_CODE[normalizeCountryCode(countryCode)];
  }

  function getCountryCodeByName(countryName) {
    const normalized = normalizeCountryName(countryName);
    if (normalized === '') return null;
    return countryCodesByNormalizedName.get(normalized) ?? null;
  }

  const X_ABOUT_ACCOUNT_LOCATION_SOURCE = 'x-about-account';

  function isPlainObject$2(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function readOwn(object, property) {
    if (!isPlainObject$2(object) || !Object.prototype.hasOwnProperty.call(object, property)) {
      return { usable: false };
    }
    return { usable: true, value: object[property] };
  }

  const unavailable = () => createUnavailableLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });

  /** Parses only the versioned, observed About Account response path. */
  function parseXAboutAccountLocationPayload(payload) {
    let topLevelIsPlain;
    try {
      topLevelIsPlain = isPlainObject$2(payload);
    } catch {
      topLevelIsPlain = false;
    }
    if (!topLevelIsPlain) throw new TypeError('X About Account payload must be a plain object');

    try {
      let current = payload;
      for (const property of ['data', 'user_result_by_screen_name', 'result', 'about_profile']) {
        const next = readOwn(current, property);
        if (!next.usable) return unavailable();
        current = next.value;
      }
      if (!isPlainObject$2(current)) return unavailable();

      if (!Object.prototype.hasOwnProperty.call(current, 'account_based_in')) {
        return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      const accountBasedIn = current.account_based_in;
      if (accountBasedIn == null) {
        return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      if (typeof accountBasedIn !== 'string') return unavailable();

      const rawLocation = accountBasedIn.trim();
      if (rawLocation === '') {
        return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      const countryCode = getCountryCodeByName(rawLocation);
      if (countryCode === null) {
        return createUnknownLocation({ rawLocation, source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      return createKnownLocation({
        countryCode,
        countryName: getCountryName(countryCode),
        rawLocation,
        source: X_ABOUT_ACCOUNT_LOCATION_SOURCE,
      });
    } catch {
      return unavailable();
    }
  }

  const X_ABOUT_ACCOUNT_RECOVERY_CODES = Object.freeze({
    AUTHENTICATION: 'AUTHENTICATION_STALE',
    QUERY: 'QUERY_ID_STALE',
  });

  const ACCOUNT_TARGET_PROCESSOR_VERSION = 1;

  const EMPTY$2 = Object.freeze([]);
  const REASONS = new Set(['initial', 'mutation', 'manual']);
  const hasOwn$5 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isPlainObject$1 = (value) => {
    if (!isObject(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return true;
    // A different realm has a different Object.prototype identity. Its Object.prototype still
    // terminates the prototype chain directly, unlike a class prototype.
    return Object.getPrototypeOf(prototype) === null
      && hasOwn$5(prototype, 'constructor')
      && Function.prototype.toString.call(prototype.constructor)
        === Function.prototype.toString.call(Object);
  };
  const TARGET_KEYS = Object.freeze([
    'version', 'source', 'accountContainer', 'link', 'badgeContainer', 'identity',
  ]);
  const IDENTITY_KEYS$1 = Object.freeze([
    'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
  ]);
  const UPDATED_KEYS = Object.freeze(['previous', 'current']);
  const DIAGNOSTIC_CODES = new Set(['PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'NETWORK', 'INVALID_RESPONSE',
    'INVALID_PAYLOAD', 'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX']);
  const DIAGNOSTIC_MESSAGES = Object.freeze({
    PAGE_BRIDGE_UNAVAILABLE: 'About Account request bridge unavailable.',
    NO_METADATA: 'About Account metadata is unavailable.',
    NETWORK: 'About Account network request failed.', INVALID_RESPONSE: 'About Account response was invalid.',
    INVALID_PAYLOAD: 'About Account response payload was invalid.', HTTP_400: 'About Account request rejected.',
    HTTP_401: 'About Account authentication metadata rejected.', HTTP_403: 'About Account authentication metadata rejected.',
    HTTP_404: 'About Account query ID rejected.', HTTP_429: 'About Account lookup rate limited.',
    HTTP_5XX: 'About Account server request failed.',
  });

  function sanitizedDiagnosticError(error, fallback) {
    const code = typeof error?.code === 'string' && DIAGNOSTIC_CODES.has(error.code) ? error.code : null;
    const diagnostic = new Error(code === null ? fallback : DIAGNOSTIC_MESSAGES[code]);
    if (code !== null) Object.defineProperty(diagnostic, 'code', { value: code, enumerable: false });
    const status = error?.status;
    if (code !== null && Number.isInteger(status) && status >= 100 && status <= 599) {
      Object.defineProperty(diagnostic, 'status', { value: status, enumerable: false });
    }
    return diagnostic;
  }

  function hasExactlyOwnKeys(value, keys) {
    if (!isPlainObject$1(value)) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length && keys.every((key) => hasOwn$5(value, key));
  }

  function normalizeOptions$2(options) {
    if (!isObject(options)) {
      throw new TypeError('account target processor options must be a plain object');
    }
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('account target processor options must be a plain object');
    }
    if (hasOwn$5(options, 'accountId')) {
      throw new TypeError('accountId is not supported by account target processing');
    }
    if (!hasOwn$5(options, 'source') || typeof options.source !== 'string') {
      throw new TypeError('Invalid account target processor source');
    }
    const source = options.source.trim().toLowerCase();
    if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
      throw new TypeError('Invalid account target processor source');
    }
    // Normalize before retaining any callback or other caller-supplied reference. An inherited
    // value is deliberately read as absent.
    const suppliedSettings = hasOwn$5(options, 'settings') ? options.settings : undefined;
    const settings = normalizeSettings(suppliedSettings);
    if (!hasOwn$5(options, 'loadAboutAccountPayload')
      || typeof options.loadAboutAccountPayload !== 'function') {
      throw new TypeError('loadAboutAccountPayload must be a function');
    }
    if (!hasOwn$5(options, 'abortControllerFactory')
      || typeof options.abortControllerFactory !== 'function') {
      throw new TypeError('abortControllerFactory must be a function');
    }
    if (!hasOwn$5(options, 'onError') || typeof options.onError !== 'function') {
      throw new TypeError('onError must be a function');
    }
    if (hasOwn$5(options, 'resolveFlagAssetUrl') && typeof options.resolveFlagAssetUrl !== 'function') {
      throw new TypeError('resolveFlagAssetUrl must be a function');
    }
    return {
      source,
      settings,
      hasBaseUrl: hasOwn$5(options, 'baseUrl'),
      baseUrl: options.baseUrl,
      loadAboutAccountPayload: options.loadAboutAccountPayload,
      abortControllerFactory: options.abortControllerFactory,
      onError: options.onError,
      resolveFlagAssetUrl: options.resolveFlagAssetUrl ?? (() => ''),
    };
  }

  function validTarget(target, source) {
    if (!hasExactlyOwnKeys(target, TARGET_KEYS)
      || target.version !== ACCOUNT_TARGET_DISCOVERY_VERSION || target.source !== source
      || !isObject(target.accountContainer) || !isObject(target.link)
      || typeof target.link.tagName !== 'string' || target.link.tagName.toLowerCase() !== 'a'
      || !isObject(target.link.ownerDocument) || typeof target.link.getAttribute !== 'function'
      || !hasExactlyOwnKeys(target.identity, IDENTITY_KEYS$1)) return false;

    const identity = target.identity;
    let canonical;
    try {
      canonical = createAccountIdentity({
        handle: identity.handle,
        accountId: identity.accountId,
        source: identity.source,
      });
      // This invokes the existing renderer's non-mutating container validation boundary.
      findLocationBadge(target.badgeContainer);
    } catch { return false; }
    return identity.source === source && IDENTITY_KEYS$1.every((key) => identity[key] === canonical[key]);
  }

  function validAuxiliary(change, source) {
    if (!change.added.every((target) => validTarget(target, source))
      || !change.removed.every((target) => validTarget(target, source))) return false;
    return change.updated.every((update) => hasExactlyOwnKeys(update, UPDATED_KEYS)
      && validTarget(update.previous, source) && validTarget(update.current, source));
  }

  function validateChange(change, source) {
    let valid = false;
    try {
      valid = isPlainObject$1(change) && change.version === ACCOUNT_TARGET_OBSERVER_VERSION
        && REASONS.has(change.reason) && change.source === source
        && Array.isArray(change.current) && Array.isArray(change.added)
        && Array.isArray(change.updated) && Array.isArray(change.removed)
        && change.current.every((target) => validTarget(target, source))
        && validAuxiliary(change, source);
    } catch { valid = false; }
    if (!valid) {
      throw new TypeError('Invalid account target change');
    }
    let duplicate = true;
    try {
      const containers = new Set(change.current.map((target) => target.accountContainer));
      duplicate = containers.size !== change.current.length;
    } catch { /* Report the common validation error below. */ }
    if (duplicate) {
      throw new TypeError('Invalid account target change');
    }
  }

  /** Coordinates explicitly supplied account targets without starting observation or transport. */
  function createXAccountTargetProcessor(options) {
    const normalized = normalizeOptions$2(options);
    let settings = normalized.settings;
    let active = false;
    let generation = 0;
    let targets = EMPTY$2;
    let targetByContainer = new Map();
    let accounts = new Map();

    const report = (error) => {
      try { normalized.onError(error); } catch { /* The injected error boundary is intentionally silent. */ }
    };
    const readerOptions = () => (normalized.hasBaseUrl
      ? { source: normalized.source, baseUrl: normalized.baseUrl }
      : { source: normalized.source });
    const removeBadge = (target) => removeLocationBadge(target.badgeContainer);
    const removeAction = (target) => removeAccountAction(target.accountContainer);

    const present = (target, location) => {
      let identity;
      try { identity = readXAccountIdentityFromLink(target.link, readerOptions()); } catch {
        identity = null;
      }
      if (identity === null || identity.source !== target.identity.source
        || identity.allowlistKey !== target.identity.allowlistKey) {
        try { removeBadge(target); } catch { /* Link drift cleanup is best effort. */ }
        try { removeAction(target); } catch { /* Link drift cleanup is best effort. */ }
        return;
      }
      const observation = normalized.hasBaseUrl
        ? { source: normalized.source, location, baseUrl: normalized.baseUrl }
        : { source: normalized.source, location };
      try {
        const evaluation = presentXAccountLink(target.link, target.badgeContainer, observation, settings,
          normalized.resolveFlagAssetUrl);
        if (evaluation === null) removeAction(target);
        else applyAccountAction(target.accountContainer, evaluation.action);
      } catch {
        try { removeAction(target); } catch { /* Presentation cleanup is best effort. */ }
        report(new Error('Unable to present account location'));
      }
    };
    const presentEntry = (entry) => {
      for (const target of targets) {
        if (entry.targets.has(target) && entry.location !== null) present(target, entry.location);
      }
    };
    const isCurrent = (entry) => active && entry.live && entry.generation === generation
      && accounts.get(entry.key) === entry && entry.targets.size > 0;
    const resolveFailure = (entry, message, error = null) => {
      if (!isCurrent(entry)) return;
      entry.pending = null;
      entry.controller = null;
      if (error?.name === 'AbortError' || error?.code === 'ABORTED') return;
      entry.location = createUnavailableLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      entry.recoverable = error?.code === X_ABOUT_ACCOUNT_RECOVERY_CODES.AUTHENTICATION
        || error?.code === X_ABOUT_ACCOUNT_RECOVERY_CODES.QUERY;
      report(sanitizedDiagnosticError(error, message));
      presentEntry(entry);
    };
    const startLookup = (entry) => {
      let controller;
      let promise;
      try {
        controller = normalized.abortControllerFactory();
        if (!isObject(controller) || !hasOwn$5(controller, 'signal')
          || typeof controller.abort !== 'function') throw new TypeError('invalid abort controller');
        entry.controller = controller;
        const context = Object.freeze({
          version: ACCOUNT_TARGET_PROCESSOR_VERSION,
          signal: controller.signal,
        });
        promise = Promise.resolve(normalized.loadAboutAccountPayload(entry.identity, context));
        entry.pending = promise;
      } catch {
        entry.controller = null;
        resolveFailure(entry, 'Unable to load account location');
        return;
      }
      promise.then((payload) => {
        if (!isCurrent(entry) || entry.pending !== promise) return;
        let location;
        try { location = parseXAboutAccountLocationPayload(payload); } catch {
          resolveFailure(entry, 'Unable to parse account location');
          return;
        }
        if (!isCurrent(entry) || entry.pending !== promise) return;
        entry.pending = null;
        entry.controller = null;
        entry.location = location;
        presentEntry(entry);
      }, (error) => resolveFailure(entry, 'Unable to load account location', error));
    };
    const retireEmptyEntries = () => {
      for (const [key, entry] of accounts) {
        if (entry.targets.size !== 0) continue;
        entry.live = false;
        accounts.delete(key);
        const controller = entry.controller;
        entry.pending = null;
        entry.controller = null;
        entry.location = null;
        if (controller !== null) {
          try { controller.abort(); } catch { /* Cancellation failure is intentionally silent. */ }
        }
      }
    };

    const start = () => {
      if (active) return targets;
      active = true;
      generation += 1;
      return targets;
    };
    const stop = () => {
      if (!active) return;
      active = false;
      generation += 1;
      let failed = false;
      for (const entry of accounts.values()) {
        entry.live = false;
        const controller = entry.controller;
        entry.pending = null;
        entry.controller = null;
        entry.location = null;
        entry.targets.clear();
        if (controller !== null) {
          try { controller.abort(); } catch { failed = true; }
        }
      }
      for (const target of targets) {
        try { removeBadge(target); } catch { failed = true; }
        try { removeAction(target); } catch { failed = true; }
      }
      accounts.clear();
      targetByContainer.clear();
      targets = EMPTY$2;
      // Replace collections so no internal capacity continues to reference removed values.
      accounts = new Map();
      targetByContainer = new Map();
      if (failed) report(new Error('Unable to clean up account target processing'));
    };
    const processChange = (change) => {
      if (!active) throw new TypeError('account target processor is not active');
      validateChange(change, normalized.source);

      const nextTargets = change.current.length === 0 ? EMPTY$2 : Object.freeze([...change.current]);
      const nextByContainer = new Map(nextTargets.map((target) => [target.accountContainer, target]));
      let cleanupFailed = false;
      let actionCleanupFailed = false;
      for (const previous of targets) {
        const next = nextByContainer.get(previous.accountContainer);
        if (next === previous) continue;
        const entry = accounts.get(previous.identity.allowlistKey);
        if (entry) entry.targets.delete(previous);
        try { removeBadge(previous); } catch { cleanupFailed = true; }
        try { removeAction(previous); } catch { actionCleanupFailed = true; }
      }

      targets = nextTargets;
      targetByContainer = nextByContainer;
      const entriesToStart = [];
      for (const target of targets) {
        // The map now contains the new snapshot; membership in an entry identifies stable records.
        let entry = accounts.get(target.identity.allowlistKey);
        if (entry?.targets.has(target)) continue;
        if (!entry) {
          entry = {
            key: target.identity.allowlistKey,
            identity: target.identity,
            targets: new Set(),
            pending: null,
            controller: null,
            location: null,
            generation,
            live: true,
            recoverable: false,
          };
          accounts.set(entry.key, entry);
          entriesToStart.push(entry);
        }
        entry.targets.add(target);
        if (entry.location !== null) present(target, entry.location);
      }
      retireEmptyEntries();
      for (const entry of entriesToStart) {
        if (isCurrent(entry) && entry.pending === null && entry.location === null) startLookup(entry);
      }
      if (cleanupFailed) report(new Error('Unable to remove account location badge'));
      if (actionCleanupFailed) report(new Error('Unable to remove account filter action'));
      return targets;
    };
    const setSettings = (value) => {
      const next = normalizeSettings(value);
      settings = next;
      if (active) {
        for (const target of targets) {
          const entry = accounts.get(target.identity.allowlistKey);
          if (entry?.location !== null && entry?.location !== undefined) present(target, entry.location);
        }
      }
      return settings;
    };
    const getTargets = () => targets;
    const retryRecoverable = () => {
      if (!active) return 0;
      let count = 0;
      for (const entry of accounts.values()) {
        if (!entry.recoverable || !isCurrent(entry) || entry.pending !== null) continue;
        entry.recoverable = false;
        entry.location = null;
        startLookup(entry);
        count += 1;
      }
      return count;
    };
    const isActive = () => active;

    return Object.freeze({ start, stop, processChange, setSettings, retryRecoverable, getTargets, isActive });
  }

  const X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION = 1;

  const hasOwn$4 = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const REQUEST_ERROR = 'Invalid X About Account payload broker request';

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype === null || prototype === Object.prototype) return true;
      return Object.getPrototypeOf(prototype) === null
        && hasOwn$4(prototype, 'constructor')
        && Function.prototype.toString.call(prototype.constructor)
          === Function.prototype.toString.call(Object);
    } catch {
      return false;
    }
  }

  function hasExactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    try {
      const ownKeys = Reflect.ownKeys(value);
      return ownKeys.length === keys.length && keys.every((key) => hasOwn$4(value, key));
    } catch {
      return false;
    }
  }

  function abortError$1() {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function validateRequest(identity, context) {
    const identityKeys = [
      'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
    ];
    const contextKeys = ['version', 'signal'];
    try {
      if (!hasExactKeys(identity, identityKeys) || !hasExactKeys(context, contextKeys)) return null;
      const canonical = createAccountIdentity({
        handle: identity.handle,
        accountId: identity.accountId,
        source: identity.source,
      });
      if (canonical.source === null
        || identityKeys.some((key) => identity[key] !== canonical[key])
        || context.version !== ACCOUNT_TARGET_PROCESSOR_VERSION) return null;
      const signal = context.signal;
      if (signal === null || typeof signal !== 'object'
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function') return null;
      return {
        handle: canonical.handle,
        accountId: canonical.accountId,
        signal,
        aborted: signal.aborted,
      };
    } catch {
      return null;
    }
  }

  function createXAboutAccountPayloadBroker(options) {
    let optionsPrototype;
    try { optionsPrototype = Object.getPrototypeOf(options); } catch { optionsPrototype = undefined; }
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || (optionsPrototype !== null && optionsPrototype !== Object.prototype)) {
      throw new TypeError('X About Account payload broker options must be a plain object');
    }
    if (!hasOwn$4(options, 'loadPayload') || typeof options.loadPayload !== 'function') {
      throw new TypeError('loadPayload must be a function');
    }
    if (!hasOwn$4(options, 'abortControllerFactory')
      || typeof options.abortControllerFactory !== 'function') {
      throw new TypeError('abortControllerFactory must be a function');
    }
    if (!hasOwn$4(options, 'onError') || typeof options.onError !== 'function') {
      throw new TypeError('onError must be a function');
    }
    const loadPayload = options.loadPayload;
    const abortControllerFactory = options.abortControllerFactory;
    const onError = options.onError;
    let active = false;
    let generation = 0;
    let entries = new Map();

    function report(error) {
      try { onError(error); } catch { /* The error boundary must not disrupt cleanup. */ }
    }

    function start() {
      if (!active) {
        active = true;
        generation += 1;
        entries = new Map();
      }
      return controller;
    }

    function retireEntry(entry) {
      if (entry.key !== null && entries.get(entry.key) === entry) entries.delete(entry.key);
      entry.live = false;
      const consumers = [...entry.consumers];
      entry.consumers.clear();
      const abortShared = entry.abort;
      entry.key = null;
      entry.generation = null;
      entry.controller = null;
      entry.abort = null;
      entry.promise = null;
      entry.identity = null;
      return { consumers, abortShared };
    }

    function stop() {
      if (!active) return controller;
      active = false;
      generation += 1;
      const retired = entries;
      entries = new Map();
      const cleanup = [];
      for (const entry of retired.values()) {
        cleanup.push(retireEntry(entry));
      }
      retired.clear();
      let failed = false;
      for (const { consumers, abortShared } of cleanup) {
        for (const consumer of consumers) {
          consumer.active = false;
          try { consumer.signal.removeEventListener('abort', consumer.listener); } catch { failed = true; }
          consumer.signal = null;
          consumer.listener = null;
          consumer.reject(abortError$1());
          consumer.resolve = null;
          consumer.reject = null;
        }
        try { abortShared(); } catch { failed = true; }
      }
      cleanup.length = 0;
      if (failed) report(new Error('Unable to stop X About Account payload broker'));
      return controller;
    }

    function settle(entry, completingPromise, succeeded, value) {
      if (!active || entry.generation !== generation || !entry.live
        || entries.get(entry.key) !== entry || entry.promise !== completingPromise) return;
      const { consumers } = retireEntry(entry);
      let failed = false;
      for (const consumer of consumers) {
        if (!consumer.active) continue;
        consumer.active = false;
        try { consumer.signal.removeEventListener('abort', consumer.listener); } catch { failed = true; }
        consumer.signal = null;
        consumer.listener = null;
        const deliver = succeeded ? consumer.resolve : consumer.reject;
        consumer.resolve = null;
        consumer.reject = null;
        deliver(value);
      }
      if (failed) report(new Error('Unable to clean up X About Account payload broker'));
    }

    function addConsumer(entry, signal) {
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const consumer = {
        active: true, signal, listener: null, resolve: resolvePromise, reject: rejectPromise,
      };
      function cancelConsumer() {
        if (!consumer.active) return;
        consumer.active = false;
        entry.consumers.delete(consumer);
        try { signal.removeEventListener('abort', consumer.listener); } catch {
          // Cancellation is expected control flow and never reaches the error boundary.
        }
        consumer.signal = null;
        consumer.listener = null;
        const reject = consumer.reject;
        consumer.resolve = null;
        consumer.reject = null;
        reject(abortError$1());
        if (entry.live && entry.consumers.size === 0) {
          const { abortShared } = retireEntry(entry);
          try { abortShared(); } catch {
            report(new Error('Unable to cancel shared About Account lookup'));
          }
        }
      }
      consumer.listener = cancelConsumer;
      entry.consumers.add(consumer);
      try {
        signal.addEventListener('abort', consumer.listener, { once: true });
        if (consumer.active && signal.aborted) cancelConsumer();
      } catch (error) {
        if (consumer.active) {
          consumer.active = false;
          entry.consumers.delete(consumer);
          try { signal.removeEventListener('abort', consumer.listener); } catch {
            // Registration failure cleanup is best-effort and exposes no signal details.
          }
          consumer.signal = null;
          consumer.listener = null;
          consumer.resolve = null;
          consumer.reject = null;
          rejectPromise(error);
          if (entry.live && entry.consumers.size === 0) {
            const { abortShared } = retireEntry(entry);
            try { abortShared(); } catch {
              report(new Error('Unable to cancel shared About Account lookup'));
            }
          }
        }
      }
      return promise;
    }

    function loadAboutAccountPayload(identity, context) {
      if (!active) throw new TypeError('X About Account payload broker is not active');
      const request = validateRequest(identity, context);
      if (request === null) throw new TypeError(REQUEST_ERROR);
      if (request.aborted) return Promise.reject(abortError$1());
      const key = JSON.stringify([request.handle, request.accountId]);
      const existing = entries.get(key);
      if (existing) return addConsumer(existing, request.signal);

      let sharedController;
      try {
        sharedController = abortControllerFactory();
      } catch (error) {
        return Promise.reject(error);
      }
      let sharedSignal;
      let sharedAbort;
      try {
        if (sharedController === null || typeof sharedController !== 'object'
          || !hasOwn$4(sharedController, 'signal')) throw new TypeError();
        sharedAbort = sharedController.abort;
        if (typeof sharedAbort !== 'function') throw new TypeError();
        sharedSignal = sharedController.signal;
      } catch {
        return Promise.reject(
          new TypeError('abortControllerFactory returned an invalid controller'),
        );
      }
      const entry = {
        key,
        generation,
        live: true,
        controller: sharedController,
        abort: () => sharedAbort.call(sharedController),
        promise: null,
        identity: createAccountIdentity({
          handle: request.handle, accountId: request.accountId, source: null,
        }),
        consumers: new Set(),
      };
      entries.set(key, entry);
      const consumerPromise = addConsumer(entry, request.signal);
      if (!entry.live || entry.consumers.size === 0) return consumerPromise;
      const underlyingContext = Object.freeze({
        version: X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION,
        signal: sharedSignal,
      });
      let result;
      try { result = loadPayload(entry.identity, underlyingContext); } catch (error) {
        result = Promise.reject(error);
      }
      const pending = Promise.resolve(result);
      entry.promise = pending;
      pending.then(
        (payload) => settle(entry, pending, true, payload),
        (error) => settle(entry, pending, false, error),
      );
      return consumerPromise;
    }

    function getInFlightCount() { return active ? entries.size : 0; }
    function isActive() { return active; }

    const controller = Object.freeze({
      start,
      stop,
      loadAboutAccountPayload,
      getInFlightCount,
      isActive,
    });
    return controller;
  }

  const EMPTY$1 = Object.freeze([]);
  const hasOwn$3 = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

  function normalizeOptions$1(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || (Object.getPrototypeOf(options) !== Object.prototype
        && Object.getPrototypeOf(options) !== null)) {
      throw new TypeError('account target session options must be a plain object');
    }
    if (hasOwn$3(options, 'accountId')) {
      throw new TypeError('accountId is not supported by account target sessions');
    }
    if (!hasOwn$3(options, 'source') || typeof options.source !== 'string') {
      throw new TypeError('Invalid account target session source');
    }
    const source = options.source.trim().toLowerCase();
    if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
      throw new TypeError('Invalid account target session source');
    }
    const settingsRuntime = hasOwn$3(options, 'settingsRuntime') ? options.settingsRuntime : null;
    if (settingsRuntime === null || typeof settingsRuntime !== 'object'
      || typeof settingsRuntime.getSettings !== 'function'
      || typeof settingsRuntime.subscribe !== 'function') {
      throw new TypeError('settingsRuntime must provide getSettings and subscribe');
    }
    for (const [property, message] of [
      ['observerFactory', 'observerFactory must be a function'],
      ['loadAboutAccountPayload', 'loadAboutAccountPayload must be a function'],
      ['abortControllerFactory', 'abortControllerFactory must be a function'],
      ['onError', 'onError must be a function'],
    ]) {
      if (!hasOwn$3(options, property) || typeof options[property] !== 'function') {
        throw new TypeError(message);
      }
    }
    if (hasOwn$3(options, 'resolveFlagAssetUrl') && typeof options.resolveFlagAssetUrl !== 'function') {
      throw new TypeError('resolveFlagAssetUrl must be a function');
    }
    return {
      source,
      hasBaseUrl: hasOwn$3(options, 'baseUrl'),
      baseUrl: options.baseUrl,
      settingsRuntime,
      observerFactory: options.observerFactory,
      loadAboutAccountPayload: options.loadAboutAccountPayload,
      abortControllerFactory: options.abortControllerFactory,
      onError: options.onError,
      resolveFlagAssetUrl: hasOwn$3(options, 'resolveFlagAssetUrl') ? options.resolveFlagAssetUrl : () => '',
    };
  }

  /** Composes one explicit root and source with account observation and processing. */
  function createXAccountTargetSession(root, options) {
    if (root === null || typeof root !== 'object' || Array.isArray(root)
      || typeof root.querySelectorAll !== 'function') {
      throw new TypeError('Invalid account target session root');
    }
    const normalized = normalizeOptions$1(options);
    let active = false;
    let generation = 0;
    let processor = null;
    let observer = null;
    let unsubscribe = null;
    let stopContext = null;

    const report = (error) => {
      try { normalized.onError(error); } catch { /* The injected error boundary is intentionally silent. */ }
    };
    const current = (expectedGeneration, expectedProcessor) => active
      && generation === expectedGeneration && processor === expectedProcessor;

    const start = () => {
      if (active) return processor.getTargets();
      const lifecycle = generation + 1;
      let createdProcessor = null;
      let createdObserver = null;
      let createdUnsubscribe = null;
      active = true;
      generation = lifecycle;
      try {
        const settings = normalized.settingsRuntime.getSettings();
        if (settings === null || settings === undefined) {
          throw new TypeError('settings runtime has no current settings');
        }
        const processorOptions = {
          source: normalized.source,
          settings,
          loadAboutAccountPayload: normalized.loadAboutAccountPayload,
          abortControllerFactory: normalized.abortControllerFactory,
          onError: (error) => {
            if (stopContext !== null && stopContext.lifecycle === lifecycle
              && stopContext.processor === createdProcessor) {
              stopContext.failed = true;
            } else if (current(lifecycle, createdProcessor)) report(error);
          },
          resolveFlagAssetUrl: normalized.resolveFlagAssetUrl,
        };
        if (normalized.hasBaseUrl) processorOptions.baseUrl = normalized.baseUrl;
        createdProcessor = createXAccountTargetProcessor(processorOptions);
        processor = createdProcessor;
        createdProcessor.start();

        createdUnsubscribe = normalized.settingsRuntime.subscribe((nextSettings) => {
          if (!current(lifecycle, createdProcessor)) return;
          try { createdProcessor.setSettings(nextSettings); } catch {
            report(new Error('Unable to apply account target settings'));
          }
        });
        if (typeof createdUnsubscribe !== 'function') {
          throw new TypeError('settingsRuntime.subscribe must return an unsubscribe function');
        }
        unsubscribe = createdUnsubscribe;

        const observerOptions = {
          source: normalized.source,
          observerFactory: normalized.observerFactory,
          onChange: (change) => {
            if (current(lifecycle, createdProcessor)) createdProcessor.processChange(change);
          },
          onError: (error) => {
            if (current(lifecycle, createdProcessor)) report(error);
          },
        };
        if (normalized.hasBaseUrl) observerOptions.baseUrl = normalized.baseUrl;
        createdObserver = createXAccountTargetObserver(root, observerOptions);
        observer = createdObserver;
        createdObserver.start();
        return createdProcessor.getTargets();
      } catch (error) {
        active = false;
        generation += 1;
        if (createdObserver !== null) {
          try { createdObserver.stop(); } catch { /* Preserve the startup error. */ }
        }
        if (typeof createdUnsubscribe === 'function') {
          try { createdUnsubscribe(); } catch { /* Preserve the startup error. */ }
        }
        if (createdProcessor !== null) {
          try { createdProcessor.stop(); } catch { /* Preserve the startup error. */ }
        }
        observer = null;
        unsubscribe = null;
        processor = null;
        throw error;
      }
    };

    const stop = () => {
      if (!active) return;
      const currentObserver = observer;
      const currentUnsubscribe = unsubscribe;
      const currentProcessor = processor;
      active = false;
      generation += 1;
      observer = null;
      unsubscribe = null;
      processor = null;
      const cleanup = { lifecycle: generation - 1, processor: currentProcessor, failed: false };
      stopContext = cleanup;
      try { currentObserver.stop(); } catch { cleanup.failed = true; }
      try { currentUnsubscribe(); } catch { cleanup.failed = true; }
      try { currentProcessor.stop(); } catch { cleanup.failed = true; }
      stopContext = null;
      if (cleanup.failed) report(new Error('Unable to stop account target session'));
    };
    const rescan = () => {
      if (!active) throw new TypeError('account target session is not active');
      observer.rescan();
      return processor.getTargets();
    };
    const getTargets = () => (active ? processor.getTargets() : EMPTY$1);
    const retryRecoverable = () => (active ? processor.retryRecoverable() : 0);
    const isActive = () => active;

    return Object.freeze({ start, stop, rescan, retryRecoverable, getTargets, isActive });
  }

  const ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION = 1;
  const EMPTY = Object.freeze([]);
  const hasOwn$2 = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const OPTION_KEYS = new Set([
    'settingsRuntime', 'observerFactory', 'loadPayload', 'brokerAbortControllerFactory',
    'consumerAbortControllerFactory', 'navigationObserverFactory', 'onError', 'baseUrl',
    'resolveFlagAssetUrl',
  ]);

  function plain$2(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try { return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null; } catch { return false; }
  }

  function normalizeOptions(options) {
    if (!plain$2(options)) throw new TypeError('account target route session options must be a plain object');
    let keys;
    try { keys = Reflect.ownKeys(options); } catch { throw new TypeError('Invalid account target route session options'); }
    if (keys.includes('accountId')) {
      throw new TypeError('accountId is not supported by account target route sessions');
    }
    if (keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key))) {
      throw new TypeError('Invalid account target route session options');
    }
    const values = {};
    const hasBaseUrl = keys.includes('baseUrl');
    try {
      for (const key of keys) values[key] = options[key];
    } catch { throw new TypeError('Invalid account target route session options'); }
    const settingsRuntime = keys.includes('settingsRuntime') ? values.settingsRuntime : null;
    if (settingsRuntime === null || typeof settingsRuntime !== 'object'
      || typeof settingsRuntime.getSettings !== 'function' || typeof settingsRuntime.subscribe !== 'function') {
      throw new TypeError('settingsRuntime must provide getSettings and subscribe');
    }
    for (const [key, message] of [
      ['observerFactory', 'observerFactory must be a function'],
      ['loadPayload', 'loadPayload must be a function'],
      ['brokerAbortControllerFactory', 'brokerAbortControllerFactory must be a function'],
      ['consumerAbortControllerFactory', 'consumerAbortControllerFactory must be a function'],
      ['navigationObserverFactory', 'navigationObserverFactory must be a function'],
      ['onError', 'onError must be a function'],
    ]) if (!keys.includes(key) || typeof values[key] !== 'function') throw new TypeError(message);
    const normalized = {
      settingsRuntime, observerFactory: values.observerFactory, loadPayload: values.loadPayload,
      brokerAbortControllerFactory: values.brokerAbortControllerFactory,
      consumerAbortControllerFactory: values.consumerAbortControllerFactory,
      navigationObserverFactory: values.navigationObserverFactory, onError: values.onError,
      hasBaseUrl,
      resolveFlagAssetUrl: values.resolveFlagAssetUrl ?? (() => ''),
    };
    if (hasBaseUrl) normalized.baseUrl = values.baseUrl;
    return normalized;
  }

  function samePlan(left, right) {
    const leftBase = hasOwn$2(left, 'baseUrl');
    const rightBase = hasOwn$2(right, 'baseUrl');
    return left.root === right.root && left.source === right.source && leftBase === rightBase
      && (!leftBase || Object.is(left.baseUrl, right.baseUrl));
  }

  function createXAccountTargetRouteSessionController(root, options) {
    let validRoot = false;
    try {
      validRoot = root !== null && typeof root === 'object' && !Array.isArray(root)
        && typeof root.querySelectorAll === 'function';
    } catch { /* standard root error */ }
    if (!validRoot) throw new TypeError('Invalid account target route session root');
    const dependencies = normalizeOptions(options);
    let active = false;
    let generation = 0;
    let broker = null;
    let navigationObserver = null;
    let navigationMethods = null;
    let route = null;
    let plans = EMPTY;
    let records = null;
    let reconciling = false;
    let pendingUrl = null;
    let transaction = null;
    let finalStop = null;
    let navigationStartup = null;
    let navigationCallbackState = null;

    const report = (error) => { try { dependencies.onError(error); } catch { /* silent boundary */ } };
    const current = (lifecycle) => active && generation === lifecycle;
    const getTargets = () => {
      if (!active || records === null) return EMPTY;
      const targets = records.flatMap((record) => record.session.getTargets());
      return targets.length === 0 ? EMPTY : Object.freeze(targets);
    };
    const retryRecoverable = () => {
      if (!active || records === null) return 0;
      return records.reduce((count, record) => count + record.session.retryRecoverable(), 0);
    };
    const plannerOptions = () => (dependencies.hasBaseUrl ? { baseUrl: dependencies.baseUrl } : {});

    const transactionCurrent = (candidate) => current(candidate.lifecycle)
      && transaction === candidate && !candidate.claimed && broker === candidate.broker;

    const createRecord = (plan, candidateTransaction) => {
      let session = null;
      const record = {
        plan, session: null, state: 'constructing', pendingErrors: [], cleanup: null,
      };
      candidateTransaction.owned.add(record);
      candidateTransaction.added.push(record);
      const sessionOptions = Object.assign(Object.create(null), {
        source: plan.source,
        settingsRuntime: dependencies.settingsRuntime,
        observerFactory: dependencies.observerFactory,
        loadAboutAccountPayload: candidateTransaction.broker.loadAboutAccountPayload,
        abortControllerFactory: dependencies.consumerAbortControllerFactory,
        onError: (error) => {
          if (record.cleanup !== null) record.cleanup.failed = true;
          else if (record.state === 'starting' || record.state === 'candidate') {
            record.pendingErrors.push(error);
          } else if (current(candidateTransaction.lifecycle)
            && broker === candidateTransaction.broker
            && record.state === 'committed' && records?.includes(record)) report(error);
        },
        resolveFlagAssetUrl: dependencies.resolveFlagAssetUrl,
      });
      if (hasOwn$2(plan, 'baseUrl')) sessionOptions.baseUrl = plan.baseUrl;
      session = createXAccountTargetSession(plan.root, sessionOptions);
      record.session = session;
      if (record.state === 'constructing') record.state = 'candidate';
      return record;
    };

    const cleanRecords = (cleanupRecords) => {
      const owned = cleanupRecords.filter((record) => record.state !== 'retired');
      const context = { failed: false };
      for (let index = owned.length - 1; index >= 0; index -= 1) {
        const record = owned[index];
        if (record.state === 'retired' || record.state === 'final-stop') continue;
        if (record.state === 'retiring') continue;
        record.state = 'retiring';
        record.cleanup = context;
        if (record.session !== null) {
          try { record.session.stop(); } catch { context.failed = true; }
        }
        record.cleanup = null;
        record.state = 'retired';
        record.pendingErrors.length = 0;
      }
      if (finalStop !== null) finalStop.failed ||= context.failed;
      return context.failed;
    };

    const applyUrl = (url, lifecycle, startup = false) => {
      const transactionBroker = broker;
      const nextRoute = classifyXRoute(url);
      const nextPlans = createXAccountTargetSessionPlans(root, nextRoute, plannerOptions());
      const previous = records ?? [];
      const candidateTransaction = {
        lifecycle,
        broker: transactionBroker,
        claimed: false,
        added: [],
        owned: new Set(previous),
      };
      transaction = candidateTransaction;
      const unused = new Set(previous);
      const desired = [];
      try {
        for (const plan of nextPlans) {
          if (!transactionCurrent(candidateTransaction)) return false;
          const reusable = previous.find((record) => unused.has(record) && samePlan(record.plan, plan));
          if (reusable !== undefined) {
            unused.delete(reusable);
            desired.push(reusable);
          } else {
            const candidate = createRecord(plan, candidateTransaction);
            if (!transactionCurrent(candidateTransaction)) return false;
            desired.push(candidate);
            candidate.state = 'starting';
            try {
              candidate.session.start();
            } catch (error) {
              candidate.pendingErrors.length = 0;
              if (candidate.state === 'starting') candidate.state = 'candidate';
              throw error;
            }
            if (candidate.state === 'starting') {
              candidate.state = 'candidate';
            } else {
              candidate.pendingErrors.length = 0;
            }
            if (!transactionCurrent(candidateTransaction)) return false;
          }
        }
      } catch (error) {
        if (candidateTransaction.claimed || !current(lifecycle)) return false;
        cleanRecords(candidateTransaction.added);
        if (!transactionCurrent(candidateTransaction)) return false;
        if (startup) throw error;
        report(new Error('Unable to reconcile X account target route'));
        return false;
      }
      if (!transactionCurrent(candidateTransaction)) return false;
      for (let index = 0; index < desired.length; index += 1) {
        const record = desired[index];
        record.plan = nextPlans[index];
        record.state = 'committed';
      }
      route = nextRoute;
      plans = nextPlans;
      records = desired;
      const obsolete = previous.filter((record) => unused.has(record));
      const failed = cleanRecords(obsolete);
      if (failed && !startup && transactionCurrent(candidateTransaction)) {
        report(new Error('Unable to reconcile X account target route'));
      }
      const mayForwardCandidateErrors = !failed && pendingUrl === null
        && transactionCurrent(candidateTransaction);
      for (const record of candidateTransaction.added) {
        const buffered = record.pendingErrors.splice(0);
        if (!mayForwardCandidateErrors || record.state !== 'committed'
          || !records.includes(record)) continue;
        for (const error of buffered) {
          if (!current(lifecycle) || record.state !== 'committed'
            || broker !== transactionBroker || !records.includes(record)) break;
          report(error);
        }
      }
      return true;
    };

    const releaseTransaction = () => {
      if (transaction !== null && !transaction.claimed) {
        transaction.added.length = 0;
        transaction.owned.clear();
      }
      transaction = null;
    };

    const processUrl = (url, lifecycle, startup = false) => {
      if (reconciling) { pendingUrl = url; return; }
      reconciling = true;
      let next = url;
      try {
        while (current(lifecycle) && next !== null) {
          pendingUrl = null;
          try {
            if (startup) applyUrl(next, lifecycle, true);
            else {
              try { applyUrl(next, lifecycle); } catch {
                if (current(lifecycle)) report(new Error('Unable to reconcile X account target route'));
              }
            }
          } finally {
            releaseTransaction();
          }
          next = pendingUrl;
          startup = false;
        }
      } finally {
        pendingUrl = null;
        reconciling = false;
        if (finalStop !== null && !finalStop.finished) {
          finalStop.finish();
        }
      }
    };

    const start = () => {
      if (active) return getTargets();
      const lifecycle = generation + 1;
      let createdBroker = null;
      let createdNavigation = null;
      let createdNavigationMethods = null;
      active = true; generation = lifecycle; records = [];
      const startup = {
        lifecycle,
        broker: null,
        observer: null,
        methods: Object.create(null),
        phase: 'broker',
        claimed: false,
        pendingUrl: null,
        errors: [],
      };
      navigationStartup = startup;
      navigationCallbackState = startup;
      const startupCurrent = () => current(lifecycle) && navigationStartup === startup
        && !startup.claimed && broker === startup.broker;
      const discardStartupBuffers = () => {
        startup.pendingUrl = null;
        startup.errors.length = 0;
      };
      const finishClaimedStartup = () => {
        discardStartupBuffers();
        if (finalStop !== null) {
          finalStop.navigation = startup.observer;
          finalStop.navigationStop = startup.methods.stop ?? null;
          finalStop.finish();
        }
        if (navigationStartup === startup) navigationStartup = null;
        startup.observer = null;
        startup.methods = null;
        startup.broker = null;
        return EMPTY;
      };
      try {
        createdBroker = createXAboutAccountPayloadBroker({
          loadPayload: dependencies.loadPayload,
          abortControllerFactory: dependencies.brokerAbortControllerFactory,
          onError: (error) => {
            if (finalStop !== null && finalStop.broker === createdBroker) finalStop.failed = true;
            else if (current(lifecycle) && broker === createdBroker) report(error);
          },
        });
        broker = createdBroker;
        startup.broker = createdBroker;
        createdBroker.start();
        if (!startupCurrent()) return finishClaimedStartup();
        startup.phase = 'factory';
        const observerOptions = Object.freeze({
          version: ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION,
          onNavigate: (url) => {
            if (startup.phase !== 'committed') {
              if (!startup.claimed && navigationStartup === startup) startup.pendingUrl = url;
            } else if (current(lifecycle) && navigationObserver === startup.observer) {
              processUrl(url, lifecycle);
            }
          },
          onError: (error) => {
            if (startup.phase !== 'committed') {
              if (!startup.claimed && navigationStartup === startup) startup.errors.push(error);
            } else if (finalStop !== null && finalStop.navigation === startup.observer) {
              finalStop.failed = true;
            } else if (current(lifecycle) && navigationObserver === startup.observer) report(error);
          },
        });
        try {
          createdNavigation = dependencies.navigationObserverFactory(observerOptions);
        } catch (error) {
          if (startup.claimed) return finishClaimedStartup();
          throw error;
        }
        startup.observer = createdNavigation;
        if (!startupCurrent()) {
          try {
            if (createdNavigation !== null && typeof createdNavigation === 'object'
              && hasOwn$2(createdNavigation, 'stop')) startup.methods.stop = createdNavigation.stop;
          } catch { /* Claimed startup cleanup is best effort. */ }
          return finishClaimedStartup();
        }
        startup.phase = 'validation';
        try {
          if (createdNavigation === null || typeof createdNavigation !== 'object') throw new Error();
          const methodKeys = ['stop', 'start', 'getCurrentUrl', 'isActive'];
          createdNavigationMethods = Object.create(null);
          for (const key of methodKeys) {
            if (!hasOwn$2(createdNavigation, key)) throw new Error();
            createdNavigationMethods[key] = createdNavigation[key];
            startup.methods[key] = createdNavigationMethods[key];
            if (typeof createdNavigationMethods[key] !== 'function') throw new Error();
            if (!startupCurrent()) return finishClaimedStartup();
          }
        } catch {
          if (startup.claimed) return finishClaimedStartup();
          throw new TypeError('navigationObserverFactory returned an invalid observer');
        }
        if (!startupCurrent()) return finishClaimedStartup();
        navigationObserver = createdNavigation;
        navigationMethods = createdNavigationMethods;
        startup.phase = 'starting';
        if (!startupCurrent()) return finishClaimedStartup();
        const initialUrl = Reflect.apply(createdNavigationMethods.start, createdNavigation, []);
        if (!startupCurrent()) return finishClaimedStartup();
        if (typeof initialUrl !== 'string') throw new TypeError('X route URL must be a string');
        startup.phase = 'routing';
        processUrl(initialUrl, lifecycle, true);
        if (!startupCurrent()) return finishClaimedStartup();
        startup.phase = 'committed';
        navigationStartup = null;
        const bufferedErrors = startup.errors.splice(0);
        const bufferedUrl = startup.pendingUrl;
        startup.pendingUrl = null;
        for (const error of bufferedErrors) {
          if (!current(lifecycle) || navigationObserver !== createdNavigation) break;
          report(error);
        }
        if (current(lifecycle) && navigationObserver === createdNavigation && bufferedUrl !== null) {
          processUrl(bufferedUrl, lifecycle);
        }
        startup.broker = null;
        startup.methods = null;
        return getTargets();
      } catch (error) {
        discardStartupBuffers();
        if (startup.claimed) return finishClaimedStartup();
        active = false; generation += 1;
        const createdRecords = records ?? [];
        broker = null; navigationObserver = null; navigationMethods = null;
        route = null; plans = EMPTY; records = null;
        pendingUrl = null; reconciling = false;
        cleanRecords(createdRecords);
        if (createdNavigationMethods !== null) {
          try { Reflect.apply(createdNavigationMethods.stop, createdNavigation, []); } catch { /* preserve */ }
        }
        if (createdBroker !== null) { try { createdBroker.stop(); } catch { /* preserve */ } }
        navigationStartup = null;
        if (navigationCallbackState === startup) navigationCallbackState = null;
        startup.observer = null;
        startup.methods = null;
        startup.broker = null;
        throw error;
      }
    };

    const stop = () => {
      if (!active) return;
      const wasReconciling = reconciling;
      const claimedStartup = navigationStartup !== null
        && navigationStartup.phase !== 'committed' ? navigationStartup : null;
      const callbackState = navigationCallbackState;
      if (claimedStartup !== null) {
        claimedStartup.claimed = true;
        claimedStartup.pendingUrl = null;
        claimedStartup.errors.length = 0;
      }
      const oldNavigation = navigationObserver ?? claimedStartup?.observer ?? null;
      const oldNavigationMethods = navigationMethods ?? claimedStartup?.methods ?? null;
      const oldBroker = broker;
      const oldRecords = records;
      const claimedTransaction = transaction;
      if (claimedTransaction !== null) claimedTransaction.claimed = true;
      const cleanupRecords = [...oldRecords];
      if (claimedTransaction !== null) {
        for (const record of claimedTransaction.owned) {
          if (!cleanupRecords.includes(record)) cleanupRecords.push(record);
        }
      }
      active = false; generation += 1;
      navigationObserver = null; navigationMethods = null;
      broker = null; route = null; plans = EMPTY; records = null;
      pendingUrl = null;
      if (callbackState !== null) callbackState.phase = 'stopped';
      const context = {
        broker: oldBroker,
        navigation: oldNavigation,
        navigationStop: oldNavigationMethods?.stop ?? null,
        navigationStopped: false,
        failed: false,
        finished: false,
        finish: null,
      };
      finalStop = context;
      for (const record of cleanupRecords) {
        if (!['retiring', 'retired'].includes(record.state)) record.state = 'final-stop';
        record.pendingErrors.length = 0;
      }
      const stopNavigation = () => {
        if (context.navigationStopped || typeof context.navigationStop !== 'function'
          || context.navigation === null) return;
        context.navigationStopped = true;
        try { Reflect.apply(context.navigationStop, context.navigation, []); } catch {
          context.failed = true;
        }
      };
      stopNavigation();
      context.finish = () => {
        if (context.finished) return;
        context.finished = true;
        stopNavigation();
        for (let index = cleanupRecords.length - 1; index >= 0; index -= 1) {
          const record = cleanupRecords[index];
          if (record.state === 'retired' || record.state === 'retiring') continue;
          record.state = 'retiring';
          record.cleanup = context;
          if (record.session !== null) {
            try { record.session.stop(); } catch { context.failed = true; }
          }
          record.cleanup = null;
          record.state = 'retired';
          record.pendingErrors.length = 0;
        }
        try { oldBroker.stop(); } catch { context.failed = true; }
        if (claimedTransaction !== null) {
          claimedTransaction.added.length = 0;
          claimedTransaction.owned.clear();
        }
        cleanupRecords.length = 0;
        if (claimedStartup !== null) {
          claimedStartup.pendingUrl = null;
          claimedStartup.errors.length = 0;
        }
        if (callbackState !== null) {
          callbackState.pendingUrl = null;
          callbackState.errors.length = 0;
          callbackState.observer = null;
          callbackState.methods = null;
          callbackState.broker = null;
        }
        if (navigationCallbackState === callbackState) navigationCallbackState = null;
        finalStop = null;
        if (context.failed) report(new Error('Unable to stop X account target route session controller'));
      };
      if (!wasReconciling && claimedStartup === null) context.finish();
    };
    const reconcile = () => {
      if (!active) throw new TypeError('account target route session controller is not active');
      const lifecycle = generation;
      try {
        const url = Reflect.apply(navigationMethods.getCurrentUrl, navigationObserver, []);
        processUrl(url, lifecycle);
      } catch { report(new Error('Unable to reconcile X account target route')); }
      return getTargets();
    };
    const rescan = () => {
      if (!active) throw new TypeError('account target route session controller is not active');
      let failed = false;
      for (const { session } of records) { try { session.rescan(); } catch { failed = true; } }
      if (failed) report(new Error('Unable to rescan X account target route sessions'));
      return getTargets();
    };
    const getRoute = () => route;
    const getPlans = () => plans;
    const getInFlightCount = () => (active ? broker.getInFlightCount() : 0);
    const isActive = () => active;
    return Object.freeze({
      start, stop, reconcile, rescan, retryRecoverable, getRoute, getPlans, getTargets, getInFlightCount, isActive,
    });
  }

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

  function structurallyEqual$1(left, right) {
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
      if (!stored.found || !structurallyEqual$1(stored.value, canonical)) await persist(canonical);
      return canonical;
    }

    return Object.freeze({ loadSettings, saveSettings, resetSettings, initializeSettings });
  }

  function validateDependencies(repository, changeAdapter, onError) {
    if (!repository || typeof repository.initializeSettings !== 'function') {
      throw new TypeError('repository.initializeSettings must be a function');
    }
    if (!changeAdapter || typeof changeAdapter.subscribe !== 'function') {
      throw new TypeError('changeAdapter.subscribe must be a function');
    }
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  }

  function immutableCopy(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value)) copy[key] = immutableCopy(child, seen);
    return Object.freeze(copy);
  }

  function snapshotOf(settings) {
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('Settings repository returned invalid settings');
    }
    return immutableCopy(settings);
  }

  function structurallyEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createSettingsRuntime({ repository, changeAdapter, onError }) {
    validateDependencies(repository, changeAdapter, onError);

    const subscribers = new Set();
    let snapshot = null;
    let active = false;
    let generation = 0;
    let unsubscribeChanges = null;
    let startPromise = null;
    let refreshQueue = Promise.resolve();

    function notify(settings) {
      for (const listener of [...subscribers]) {
        try {
          listener(settings);
        } catch {
          // Subscriber failures are isolated and settings are never logged.
        }
      }
    }

    async function refresh(expectedGeneration) {
      if (!active || generation !== expectedGeneration) return;
      try {
        const next = snapshotOf(await repository.initializeSettings());
        if (!active || generation !== expectedGeneration) return;
        if (!structurallyEqual(snapshot, next)) {
          snapshot = next;
          notify(snapshot);
        }
      } catch {
        if (!active || generation !== expectedGeneration) return;
        try {
          onError(new Error('Unable to refresh extension settings'));
        } catch {
          // Error reporting must not reject or poison the serialized refresh queue.
        }
      }
    }

    function handleStorageChange(expectedGeneration, changes, areaName) {
      if (!active || generation !== expectedGeneration || areaName !== 'local') return;
      if (changes === null || typeof changes !== 'object'
        || !Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)) return;

      refreshQueue = refreshQueue.then(() => refresh(expectedGeneration), () => refresh(expectedGeneration));
    }

    function start() {
      if (active && startPromise) return startPromise;

      active = true;
      const expectedGeneration = ++generation;
      try {
        unsubscribeChanges = changeAdapter.subscribe(
          (changes, areaName) => handleStorageChange(expectedGeneration, changes, areaName),
        );
        if (typeof unsubscribeChanges !== 'function') {
          throw new TypeError('changeAdapter.subscribe must return an unsubscribe function');
        }
      } catch (error) {
        active = false;
        unsubscribeChanges = null;
        return Promise.reject(error);
      }

      const initialization = Promise.resolve().then(() => repository.initializeSettings()).then((settings) => {
        if (!active || generation !== expectedGeneration) return snapshot;
        snapshot = snapshotOf(settings);
        notify(snapshot);
        return snapshot;
      });
      refreshQueue = initialization;
      startPromise = initialization.catch((error) => {
        if (active && generation === expectedGeneration) {
          active = false;
          unsubscribeChanges?.();
          unsubscribeChanges = null;
          startPromise = null;
        }
        throw error;
      });
      return startPromise;
    }

    function stop() {
      if (!active) return;
      active = false;
      generation += 1;
      unsubscribeChanges?.();
      unsubscribeChanges = null;
      startPromise = null;
      refreshQueue = Promise.resolve();
    }

    function getSettings() {
      return snapshot;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      subscribers.add(listener);
      if (snapshot !== null) {
        try {
          listener(snapshot);
        } catch {
          // Subscriber failures are isolated and settings are never logged.
        }
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        subscribers.delete(listener);
      };
    }

    return Object.freeze({ start, stop, getSettings, subscribe });
  }

  /** Creates an adapter without registering a listener until subscribe is called. */
  function createBrowserStorageChangeAdapter(globalScope = globalThis) {
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

  async function initializeContentSettings(globalScope = globalThis) {
    const hostname = typeof globalScope.location?.hostname === 'string'
      ? globalScope.location.hostname.toLowerCase()
      : '';
    if (!SUPPORTED_HOSTNAMES.includes(hostname)) return null;

    const storageAdapter = createBrowserStorageAdapter(globalScope);
    const repository = createSettingsRepository(storageAdapter);
    const changeAdapter = createBrowserStorageChangeAdapter(globalScope);
    const runtime = createSettingsRuntime({
      repository,
      changeAdapter,
      onError: () => globalScope.console?.error?.('Unable to refresh extension settings'),
    });
    try {
      await runtime.start();
    } catch {
      runtime.stop();
      throw new Error('Unable to initialize extension settings');
    }
    return runtime;
  }

  const X_ABOUT_ACCOUNT_OPERATION_NAME = 'AboutAccountQuery';

  const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

  function isValidXAboutAccountQueryId(value) {
    return typeof value === 'string' && QUERY_ID_PATTERN.test(value);
  }

  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const HEADER_NAMES = Object.freeze([
    'authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type',
    'x-twitter-client-language', 'x-guest-token', 'x-client-transaction-id',
  ]);

  const METADATA_DETAIL_LIMIT = 65_536;

  function metadataHeaderNames() { return HEADER_NAMES; }

  function createMetadataAuthenticationFingerprint(headers) {
    if (!isMetadataPlainObject(headers)) throw new TypeError('Invalid metadata authentication headers');
    const fingerprint = Object.create(null);
    for (const name of ['authorization', 'x-csrf-token', 'x-guest-token', 'x-twitter-auth-type']) {
      if (Object.prototype.hasOwnProperty.call(headers, name)) {
        const value = headers[name];
        if (!validMetadataHeaderValue(value)) throw new TypeError('Invalid metadata authentication headers');
        fingerprint[name] = value;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(fingerprint, 'authorization')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'x-csrf-token')) {
      throw new TypeError('Invalid metadata authentication headers');
    }
    return JSON.stringify(fingerprint);
  }

  function validMetadataQueryId(value) {
    return isValidXAboutAccountQueryId(value);
  }

  function validMetadataHeaderValue(value) {
    return typeof value === 'string' && value.length > 0 && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  }

  function isMetadataPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  function copyAndValidateJsonValue(value, options = undefined) {
    let count = 0;
    const ancestors = new Set();
    function copy(candidate, depth) {
      if (candidate === null || typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate)) throw new TypeError();
        return candidate;
      }
      if (typeof candidate === 'string') {
        if (candidate.length > 16_384) throw new TypeError();
        return candidate;
      }
      if (depth > 12 || typeof candidate !== 'object' || ancestors.has(candidate)) throw new TypeError();
      if (!Array.isArray(candidate) && !isMetadataPlainObject(candidate)) throw new TypeError();
      const keys = Reflect.ownKeys(candidate);
      if (keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) throw new TypeError();
      count += Array.isArray(candidate) ? candidate.length : keys.length;
      if (count > 4_096) throw new TypeError();
      if (Array.isArray(candidate)
        && (keys.length !== candidate.length + 1
          || keys.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) throw new TypeError();
      ancestors.add(candidate);
      const output = Array.isArray(candidate) ? [] : Object.create(null);
      if (Array.isArray(candidate)) {
        for (let index = 0; index < candidate.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError();
          output.push(copy(descriptor.value, depth + 1));
        }
      } else {
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError();
          output[key] = copy(descriptor.value, depth + 1);
        }
      }
      ancestors.delete(candidate);
      return output;
    }
    const copied = copy(value, 0);
    if (options?.requireObject === true && !isMetadataPlainObject(copied)) throw new TypeError();
    return copied;
  }

  function deeplyFreezeMetadata(value) {
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) deeplyFreezeMetadata(value[key]);
      Object.freeze(value);
    }
    return value;
  }

  const X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION = 1;

  const X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION = 1;
  const X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE = 'x-region-block:about-account:request';
  const X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE = 'x-region-block:about-account:cancel';
  const X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE = 'x-region-block:about-account:response';
  const X_ABOUT_ACCOUNT_RESPONSE_LIMIT = 262_144;
  const X_ABOUT_ACCOUNT_RETRY_LIMIT = 300_000;
  const X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT = 2_147_483_647;

  const ID = /^[A-Za-z0-9_-]{16,64}$/;
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const CODES = new Set(['ABORTED', 'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'NETWORK',
    'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
    'INVALID_RESPONSE', 'INVALID_PAYLOAD', 'UNKNOWN']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain$1 = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
  const exact = (value, keys) => plain$1(value) && Reflect.ownKeys(value).length === keys.length
    && Reflect.ownKeys(value).every((key) => typeof key === 'string') && keys.every((key) => own(value, key));
  const validStatus = (value) => value === null
    || (Number.isInteger(value) && value >= 100 && value <= 599);
  const validRetry = (value) => value === null
    || (Number.isInteger(value) && value >= 0 && value <= X_ABOUT_ACCOUNT_RETRY_LIMIT);
  const validRevision = (value) => value === null
    || (Number.isInteger(value) && value >= 1 && value <= X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT);
  const canonicalParse = (input, limit) => {
    if (typeof input !== 'string' || input.length === 0 || input.length > limit) return null;
    try {
      const value = JSON.parse(input);
      return JSON.stringify(value) === input ? value : null;
    } catch { return null; }
  };

  function validOpaqueRequestId(value) { return typeof value === 'string' && ID.test(value); }
  function validCanonicalHandle(value) { return typeof value === 'string' && HANDLE.test(value); }
  function serializeAboutAccountRequest(id, handle) {
    if (!validOpaqueRequestId(id) || !validCanonicalHandle(handle)) throw new TypeError('Invalid request');
    return JSON.stringify({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id, handle });
  }
  function serializeAboutAccountCancel(id) {
    if (!validOpaqueRequestId(id)) throw new TypeError('Invalid cancellation');
    return JSON.stringify({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id });
  }
  function parseAboutAccountResponseDetail(input) {
    const value = canonicalParse(input, X_ABOUT_ACCOUNT_RESPONSE_LIMIT);
    if (!value || value.version !== X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
      || !validOpaqueRequestId(value.id) || typeof value.ok !== 'boolean') return null;
    if (value.ok) return exact(value, ['version', 'id', 'ok', 'payload'])
      ? { version: value.version, id: value.id, ok: true, payload: value.payload } : null;
    return exact(value, ['version', 'id', 'ok', 'code', 'status', 'retryAfterMs', 'metadataRevision'])
      && CODES.has(value.code) && validStatus(value.status) && validRetry(value.retryAfterMs)
      && validRevision(value.metadataRevision)
      ? { version: value.version, id: value.id, ok: false, code: value.code,
        status: value.status, retryAfterMs: value.retryAfterMs,
        metadataRevision: value.metadataRevision } : null;
  }

  const X_ABOUT_ACCOUNT_RECOVERY_STATE_VERSION = 1;

  const supportedOrigins$2 = new Set(['https://x.com', 'https://twitter.com']);
  const IDENTITY_KEYS = Object.freeze([
    'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
  ]);
  const hasOwn$1 = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const SNAPSHOT_KEYS = Object.freeze([
    'version', 'origin', 'revision', 'queryId', 'headers',
  ]);

  function exactStringKeys(value, keys) {
    if (!isMetadataPlainObject(value)) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string')
      && keys.every((key) => hasOwn$1(value, key));
  }

  function validateOptions(options) {
    let prototype;
    try { prototype = Object.getPrototypeOf(options); } catch { prototype = undefined; }
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || (prototype !== null && prototype !== Object.prototype)) {
      throw new TypeError('X About Account request metadata bridge options must be a plain object');
    }
    let keys;
    try { keys = Reflect.ownKeys(options); } catch {
      throw new TypeError('Invalid X About Account request metadata bridge options');
    }
    if (keys.length !== 1 || keys[0] !== 'onError' || !hasOwn$1(options, 'onError')) {
      throw new TypeError('Invalid X About Account request metadata bridge options');
    }
    let onError;
    try { onError = options.onError; } catch {
      throw new TypeError('Invalid X About Account request metadata bridge options');
    }
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');
    return onError;
  }

  function normalizeSnapshot(candidate, origin) {
    if (!exactStringKeys(candidate, SNAPSHOT_KEYS)
      || typeof candidate.version !== 'number'
      || candidate.version !== X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION
      || typeof candidate.origin !== 'string' || candidate.origin !== origin
      || !Number.isInteger(candidate.revision) || candidate.revision < 1
      || candidate.revision > X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT
      || typeof candidate.queryId !== 'string' || !validMetadataQueryId(candidate.queryId)
      || !isMetadataPlainObject(candidate.headers)) throw new TypeError();
    const snapshot = copyAndValidateJsonValue(candidate, { requireObject: true });
    const headerKeys = Reflect.ownKeys(snapshot.headers);
    if (headerKeys.some((key) => !metadataHeaderNames().includes(key))
      || !hasOwn$1(snapshot.headers, 'authorization') || !hasOwn$1(snapshot.headers, 'x-csrf-token')
      || headerKeys.some((key) => !validMetadataHeaderValue(snapshot.headers[key]))) throw new TypeError();
    return deeplyFreezeMetadata(snapshot);
  }

  function validIdentity(identity) {
    if (!exactStringKeys(identity, IDENTITY_KEYS)) return false;
    const canonical = createAccountIdentity({
      handle: identity.handle, accountId: identity.accountId, source: identity.source,
    });
    return canonical.source === null && IDENTITY_KEYS.every((key) => canonical[key] === identity[key]);
  }

  function createXAboutAccountRequestMetadataBridge(globalScope, options) {
    let dependencies;
    try {
      const prototype = Object.getPrototypeOf(globalScope);
      const location = globalScope.location;
      const document = globalScope.document;
      const Event = globalScope.Event;
      const URLSearchParams = globalScope.URLSearchParams;
      const origin = location.origin;
      const documentAddEventListener = document.addEventListener;
      const documentRemoveEventListener = document.removeEventListener;
      const documentDispatchEvent = document.dispatchEvent;
      if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)
        || (prototype !== null && prototype !== Object.prototype) || !supportedOrigins$2.has(origin)
        || typeof Event !== 'function' || typeof URLSearchParams !== 'function'
        || typeof documentAddEventListener !== 'function'
        || typeof documentRemoveEventListener !== 'function'
        || typeof documentDispatchEvent !== 'function') throw new TypeError();
      dependencies = { document, documentAddEventListener, documentRemoveEventListener,
        documentDispatchEvent, Event, URLSearchParams, origin };
    } catch {
      throw new TypeError('Invalid X About Account request metadata bridge global scope');
    }
    const onError = validateOptions(options);
    let active = false;
    let generation = 0;
    let listener = null;
    let startup = null;
    let snapshot = null;
    let recoveryGeneration = 0;
    let authenticationGeneration = 0;
    let acceptedAuthenticationFingerprint = null;
    let rejected = null;
    let refreshWaiters = new Set();
    const report = (error) => { try { onError(error); } catch { /* Error boundary is isolated. */ } };

    function start() {
      if (active) return;
      generation += 1;
      const ownedGeneration = generation;
      const candidateListener = (event) => {
        if (!active || ownedGeneration !== generation) return;
        try {
          const detail = event.detail;
          if (typeof detail !== 'string' || detail.length > METADATA_DETAIL_LIMIT) throw new TypeError();
          const parsed = JSON.parse(detail);
          const normalized = normalizeSnapshot(parsed, dependencies.origin);
          if (!active || ownedGeneration !== generation) return;
          if (snapshot !== null && normalized.revision <= snapshot.revision) return;
          if (rejected?.kind === 'authentication'
            && createMetadataAuthenticationFingerprint(normalized.headers) === rejected.fingerprint) return;
          if (rejected?.kind === 'query' && normalized.queryId === rejected.queryId) return;
          snapshot = normalized;
          recoveryGeneration += 1;
          const authenticationFingerprint = createMetadataAuthenticationFingerprint(normalized.headers);
          if (authenticationFingerprint !== acceptedAuthenticationFingerprint) {
            acceptedAuthenticationFingerprint = authenticationFingerprint;
            authenticationGeneration += 1;
          }
          rejected = null;
          const waiters = refreshWaiters;
          refreshWaiters = new Set();
          for (const resolve of waiters) resolve();
        } catch {
          if (active && ownedGeneration === generation) {
            report(new Error('Unable to accept X About Account request metadata'));
          }
        }
      };
      const transaction = { generation: ownedGeneration, listener: candidateListener };
      startup = transaction;
      listener = candidateListener;
      active = true;
      try {
        Reflect.apply(dependencies.documentAddEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]);
        if (!active || generation !== ownedGeneration || startup !== transaction) {
          try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
            [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
          return;
        }
        const replayEvent = new dependencies.Event(
          X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
          { bubbles: false, cancelable: false, composed: false },
        );
        if (!active || generation !== ownedGeneration || startup !== transaction) {
          try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
            [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
          return;
        }
        Reflect.apply(dependencies.documentDispatchEvent, dependencies.document, [replayEvent]);
        if (!active || generation !== ownedGeneration || startup !== transaction) {
          try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
            [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
          return;
        }
        startup = null;
      } catch {
        const stopped = !active || generation !== ownedGeneration || startup !== transaction;
        active = false;
        generation += 1;
        listener = null;
        startup = null;
        snapshot = null;
        try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Startup rollback. */ }
        if (stopped) return;
        throw new Error('Unable to start X About Account request metadata bridge');
      }
    }

    function stop() {
      if (!active && listener === null && startup === null) return;
      active = false;
      generation += 1;
      snapshot = null;
      rejected = null;
      for (const resolve of refreshWaiters) resolve();
      refreshWaiters.clear();
      refreshWaiters = new Set();
      const ownedListener = listener;
      listener = null;
      startup = null;
      if (ownedListener) {
        try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, ownedListener]); }
        catch { report(new Error('Unable to stop X About Account request metadata bridge')); }
      }
    }

    function createRequest(identity, context) {
      if (!active) throw new TypeError('X About Account request metadata bridge is not active');
      if (snapshot === null) throw new Error('X About Account request metadata is unavailable');
      try {
        if (!validIdentity(identity) || !exactStringKeys(context, ['version'])
          || context.version !== X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION) throw new TypeError();
        const variables = Object.create(null);
        variables.screenName = identity.handle;
        const parameters = new dependencies.URLSearchParams();
        parameters.set('variables', JSON.stringify(variables));
        const headers = Object.create(null);
        for (const key of Object.keys(snapshot.headers)) headers[key] = snapshot.headers[key];
        deeplyFreezeMetadata(headers);
        return Object.freeze({
          url: `${snapshot.origin}/i/api/graphql/${snapshot.queryId}/${X_ABOUT_ACCOUNT_OPERATION_NAME}?${parameters}`,
          headers,
        });
      } catch {
        throw new TypeError('Invalid X About Account request metadata request');
      }
    }

    Object.defineProperty(createRequest, 'invalidateSnapshot', {
      value: (kind) => {
        if (snapshot === null) return;
        rejected = kind === 'query'
          ? { kind, queryId: snapshot.queryId }
          : { kind: 'authentication',
            fingerprint: createMetadataAuthenticationFingerprint(snapshot.headers) };
        snapshot = null;
      }, enumerable: false, configurable: false, writable: false,
    });
    const invalidateRecovery = (kind, revision, rejectedValue) => {
      if (!Number.isInteger(revision) || revision < 1 || revision > X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT) return false;
      if ((kind !== 'query' && kind !== 'auth') || typeof rejectedValue !== 'string'
        || rejectedValue.length < 1 || rejectedValue.length > 65_536) return false;
      if (snapshot === null) return true;
      const currentValue = kind === 'query' ? snapshot.queryId : `auth-${authenticationGeneration}`;
      if (snapshot.revision !== revision && currentValue !== rejectedValue) return true;
      createRequest.invalidateSnapshot(kind); return true;
    };
    const getRecoveryState = () => {
      if (snapshot === null) return null;
      return Object.freeze({ version: X_ABOUT_ACCOUNT_RECOVERY_STATE_VERSION,
        generation: recoveryGeneration, revision: snapshot.revision, queryId: snapshot.queryId,
        authenticationFingerprint: `auth-${authenticationGeneration}` });
    };
    Object.defineProperty(createRequest, 'waitForFreshSnapshot', {
      value: (signal) => new Promise((resolve, reject) => {
        if (snapshot !== null) { resolve(); return; }
        let settled = false;
        const finish = () => {
          if (settled) return; settled = true; refreshWaiters.delete(finish);
          try { signal?.removeEventListener('abort', cancel); } catch { /* best effort */ }
          resolve();
        };
        const cancel = () => {
          if (settled) return; settled = true; refreshWaiters.delete(finish);
          const error = new Error('The operation was aborted'); error.name = 'AbortError'; reject(error);
        };
        refreshWaiters.add(finish);
        try { signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel(); }
        catch { cancel(); }
      }), enumerable: false, configurable: false, writable: false,
    });

    return Object.freeze({ start, stop, createRequest, invalidateRecovery, getRecoveryState,
      hasSnapshot: () => snapshot !== null, isActive: () => active });
  }

  const MAX_IN_FLIGHT = 4;
  const START_INTERVAL = 200;
  const BRIDGE_TIMEOUT = 30_000;
  const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  const codedError = (code, status = null) => {
    const error = new Error('About Account lookup failed');
    Object.defineProperties(error, { code: { value: code }, status: { value: status } });
    return error;
  };
  function createXAboutAccountPageTransport(globalScope, options = {}) {
    const { document, CustomEvent } = globalScope;
    const now = options.now ?? (() => Date.now());
    const setTimer = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    const clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
    const onMetadataRejected = options.onMetadataRejected ?? (() => {});
    let sequence = 0; let active = true; let inFlight = 0; let lastStart = -Infinity;
    let cooldownUntil = 0; let scheduleTimer = null;
    let recoveryState = null;
    const blockedMetadata = { auth: new Set(), query: new Set() };
    const queue = []; const pending = new Map(); const waitingMetadata = new Set();
    const dispatch = (type, detail) => document.dispatchEvent(new CustomEvent(type,
      { detail, bubbles: false, cancelable: false, composed: false }));
    const dispatchCancellation = (id) => {
      try { dispatch(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, serializeAboutAccountCancel(id)); }
      catch { /* Cancellation cleanup never depends on page event delivery. */ }
    };
    const schedule = () => {
      if (!active || scheduleTimer !== null || blockedMetadata.auth.size > 0
        || blockedMetadata.query.size > 0 || !queue.length || inFlight >= MAX_IN_FLIGHT) return;
      const wait = Math.max(0, cooldownUntil - now(), START_INTERVAL - (now() - lastStart));
      if (wait > 0) {
        scheduleTimer = setTimer(() => { scheduleTimer = null; schedule(); }, wait);
        return;
      }
      const entry = queue.shift();
      if (!entry || entry.cancelled) { schedule(); return; }
      entry.started = true; inFlight += 1; lastStart = now();
      entry.attemptRevision = recoveryState?.revision ?? null;
      entry.attemptAuthentication = recoveryState?.authenticationFingerprint ?? null;
      entry.attemptQuery = recoveryState?.queryId ?? null;
      try { dispatch(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, serializeAboutAccountRequest(entry.id, entry.handle)); }
      catch {
        entry.started = false; inFlight -= 1; pending.delete(entry.id); entry.cleanup();
        entry.reject(codedError('PAGE_BRIDGE_UNAVAILABLE')); schedule(); return;
      }
      entry.attemptTimer = setTimer(() => {
        if (!active || !entry.started || pending.get(entry.id) !== entry) return;
        entry.attemptTimer = null; entry.started = false; inFlight = Math.max(0, inFlight - 1);
        dispatchCancellation(entry.id);
        pending.delete(entry.id); entry.cleanup(); entry.reject(codedError('PAGE_BRIDGE_UNAVAILABLE'));
        schedule();
      }, BRIDGE_TIMEOUT);
      schedule();
    };
    const enqueueAttempt = (entry) => { entry.started = false; queue.push(entry); schedule(); };
    const response = (event) => {
      const result = parseAboutAccountResponseDetail(event?.detail);
      if (result === null) return;
      const entry = pending.get(result.id);
      if (!entry || !entry.started) return;
      if (entry.attemptTimer !== null) { clearTimer(entry.attemptTimer); entry.attemptTimer = null; }
      entry.started = false; inFlight = Math.max(0, inFlight - 1);
      if (entry.cancelled) { schedule(); return; }
      if (result.ok) { pending.delete(entry.id); entry.cleanup(); entry.resolve(result.payload); schedule(); return; }
      const code = result.code;
      let retryDelay = null;
      if (code === 'HTTP_429') {
        cooldownUntil = Math.max(cooldownUntil, now() + Math.min(300_000, result.retryAfterMs ?? 60_000));
        if (entry.rateRetries++ < 1) retryDelay = 0;
      } else if ((code === 'NETWORK' || code === 'HTTP_5XX') && entry.transientRetries < 2) {
        retryDelay = 1000 * (2 ** entry.transientRetries); entry.transientRetries += 1;
      } else if (['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404'].includes(code)) {
        entry.metadataKind = ['HTTP_400', 'HTTP_404'].includes(code) ? 'query' : 'auth';
        entry.rejectedMetadata = entry.metadataKind === 'query' ? entry.attemptQuery : entry.attemptAuthentication;
        if (entry.rejectedMetadata !== null) blockedMetadata[entry.metadataKind].add(entry.rejectedMetadata);
        try { onMetadataRejected(entry.metadataKind, result.metadataRevision ?? entry.attemptRevision,
          entry.rejectedMetadata); } catch { /* categorized by owner */ }
        const current = entry.metadataKind === 'query'
          ? recoveryState?.queryId : recoveryState?.authenticationFingerprint;
        const rejectedRevision = result.metadataRevision ?? entry.attemptRevision;
        entry.rejectedRevision = rejectedRevision;
        const fresh = current !== null && recoveryState?.revision !== rejectedRevision
          && current !== entry.rejectedMetadata;
        if (fresh) blockedMetadata[entry.metadataKind].delete(entry.rejectedMetadata);
        if (entry.metadataRetries++ < 1) {
          if (fresh) retryDelay = 0;
          else { waitingMetadata.add(entry); schedule(); return; }
        }
      }
      if (retryDelay !== null) {
        entry.delayTimer = setTimer(() => {
          entry.delayTimer = null; if (active && !entry.cancelled) enqueueAttempt(entry);
        }, retryDelay);
      } else {
        pending.delete(entry.id); entry.cleanup();
        entry.reject(code === 'ABORTED' ? abortError() : codedError(code, result.status));
      }
      schedule();
    };
    const updateRecoveryState = (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== 5 || value.version !== 1
        || !Number.isInteger(value.generation) || value.generation < 1
        || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 2_147_483_647
        || !isValidXAboutAccountQueryId(value.queryId)
        || typeof value.authenticationFingerprint !== 'string'
        || value.authenticationFingerprint.length < 1 || value.authenticationFingerprint.length > 65_536) return false;
      recoveryState = { version: 1, generation: value.generation, revision: value.revision, queryId: value.queryId,
        authenticationFingerprint: value.authenticationFingerprint };
      for (const [kind, current] of [['query', recoveryState.queryId],
        ['auth', recoveryState.authenticationFingerprint]]) {
        for (const rejected of [...blockedMetadata[kind]]) {
          if (rejected !== current) blockedMetadata[kind].delete(rejected);
        }
      }
      for (const entry of [...waitingMetadata]) if (active && !entry.cancelled) {
        const fresh = entry.metadataKind === 'query'
          ? recoveryState.revision !== entry.rejectedRevision && recoveryState.queryId !== entry.rejectedMetadata
          : recoveryState.revision !== entry.rejectedRevision
            && recoveryState.authenticationFingerprint !== entry.rejectedMetadata;
        if (!fresh) continue;
        waitingMetadata.delete(entry);
        // Avoid starting reentrantly inside the ordinary page request being observed.
        entry.delayTimer = setTimer(() => {
          entry.delayTimer = null; if (active && !entry.cancelled) enqueueAttempt(entry);
        }, 0);
      }
      schedule();
      return true;
    };
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
    if (options.recoveryState !== undefined && !updateRecoveryState(options.recoveryState)) {
      throw new TypeError('Invalid recovery state');
    }
    function loadPayload(identity, context) {
      let canonical;
      try { canonical = createAccountIdentity(identity); } catch { canonical = null; }
      if (!active || canonical === null || canonical.handle !== identity.handle
        || context?.version !== X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION || !context.signal) {
        return Promise.reject(codedError('PAGE_BRIDGE_UNAVAILABLE'));
      }
      if (context.signal.aborted) return Promise.reject(abortError());
      const id = `${now().toString(36).padStart(10, '0')}_${(++sequence).toString(36).padStart(8, '0')}`;
      return new Promise((resolve, reject) => {
        const entry = { id, handle: canonical.handle, resolve, reject, started: false, cancelled: false,
          transientRetries: 0, metadataRetries: 0, rateRetries: 0, cleanup: null,
          attemptRevision: null, attemptAuthentication: null, attemptQuery: null, rejectedRevision: null,
          attemptTimer: null, delayTimer: null };
        const cancel = () => {
          if (entry.cancelled) return; entry.cancelled = true; pending.delete(id);
          const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
          waitingMetadata.delete(entry);
          if (entry.attemptTimer !== null) { clearTimer(entry.attemptTimer); entry.attemptTimer = null; }
          if (entry.delayTimer !== null) { clearTimer(entry.delayTimer); entry.delayTimer = null; }
          if (entry.started) { inFlight = Math.max(0, inFlight - 1); dispatchCancellation(id); }
          entry.cleanup(); reject(abortError()); schedule();
        };
        entry.cleanup = () => context.signal.removeEventListener('abort', cancel);
        context.signal.addEventListener('abort', cancel, { once: true });
        pending.set(id, entry); enqueueAttempt(entry);
      });
    }
    return Object.freeze({ loadPayload, updateRecoveryState, stop() {
      if (!active) return; active = false;
      if (scheduleTimer !== null) { clearTimer(scheduleTimer); scheduleTimer = null; }
      document.removeEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, response);
      for (const entry of pending.values()) {
        entry.cancelled = true; entry.cleanup();
        if (entry.attemptTimer !== null) clearTimer(entry.attemptTimer);
        if (entry.delayTimer !== null) clearTimer(entry.delayTimer);
        if (entry.started) dispatchCancellation(entry.id);
        entry.reject(abortError());
      }
      pending.clear(); waitingMetadata.clear(); blockedMetadata.auth.clear();
      blockedMetadata.query.clear(); queue.length = 0; inFlight = 0;
    } });
  }

  const X_NAVIGATION_EVENT_TYPE = 'x-region-block:navigation';

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function plain(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try { return [Object.prototype, null].includes(Object.getPrototypeOf(value)); } catch { return false; }
  }

  function createXNavigationObserver(globalScope, options) {
    let location;
    let document;
    try {
      location = globalScope?.location;
      document = globalScope?.document;
      if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)
        || location === null || typeof location !== 'object' || typeof location.href !== 'string'
        || typeof globalScope.addEventListener !== 'function'
        || typeof globalScope.removeEventListener !== 'function'
        || document === null || typeof document !== 'object'
        || typeof document.addEventListener !== 'function'
        || typeof document.removeEventListener !== 'function') throw new Error();
    } catch { throw new TypeError('Invalid X navigation observer global scope'); }
    if (!plain(options)) throw new TypeError('X navigation observer options must be a plain object');
    let keys;
    try { keys = Reflect.ownKeys(options); } catch { throw new TypeError('Invalid X navigation observer options'); }
    if (keys.length !== 2 || keys.some((key) => typeof key !== 'string')
      || !hasOwn(options, 'onNavigate') || !hasOwn(options, 'onError')) {
      throw new TypeError('Invalid X navigation observer options');
    }
    let onNavigate;
    let onError;
    try {
      onNavigate = options.onNavigate;
      onError = options.onError;
    } catch { throw new TypeError('Invalid X navigation observer options'); }
    if (typeof onNavigate !== 'function') throw new TypeError('onNavigate must be a function');
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');
    let active = false;
    let generation = 0;
    let documentListener = null;
    let popstateListener = null;
    let registration = null;
    const report = (error) => { try { onError(error); } catch { /* silent boundary */ } };
    const readStartUrl = () => {
      const href = location.href;
      if (typeof href !== 'string') throw new TypeError('Invalid X navigation observer global scope');
      return href;
    };
    const start = () => {
      if (active) return readStartUrl();
      const lifecycle = generation + 1;
      const deliver = () => {
        if (!active || generation !== lifecycle) return;
        let href;
        try { href = location.href; } catch { report(new Error('Unable to read X navigation URL')); return; }
        if (typeof href !== 'string') { report(new Error('Unable to read X navigation URL')); return; }
        try { onNavigate(href); } catch { report(new Error('Unable to deliver X navigation')); }
      };
      active = true;
      generation = lifecycle;
      documentListener = deliver;
      popstateListener = deliver;
      const currentRegistration = {
        lifecycle,
        documentMayBeRegistered: false,
        globalMayBeRegistered: false,
        documentRemoved: false,
        globalRemoved: false,
        complete: false,
      };
      registration = currentRegistration;
      const stillCurrent = () => active && generation === lifecycle
        && registration === currentRegistration;
      const removeRegistered = () => {
        if (currentRegistration.documentMayBeRegistered
          && !currentRegistration.documentRemoved) {
          currentRegistration.documentRemoved = true;
          try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, deliver); } catch { /* rollback */ }
        }
        if (currentRegistration.globalMayBeRegistered && !currentRegistration.globalRemoved) {
          currentRegistration.globalRemoved = true;
          try { globalScope.removeEventListener('popstate', deliver); } catch { /* rollback */ }
        }
      };
      const interrupted = () => {
        removeRegistered();
        if (registration === currentRegistration) registration = null;
        documentListener = null;
        popstateListener = null;
        throw new Error('X navigation observer start was interrupted');
      };
      try {
        currentRegistration.documentMayBeRegistered = true;
        document.addEventListener(X_NAVIGATION_EVENT_TYPE, deliver);
        if (!stillCurrent()) interrupted();
        currentRegistration.globalMayBeRegistered = true;
        globalScope.addEventListener('popstate', deliver);
        if (!stillCurrent()) interrupted();
        const href = readStartUrl();
        if (!stillCurrent()) interrupted();
        currentRegistration.complete = true;
        return href;
      } catch (error) {
        if (stillCurrent()) { active = false; generation += 1; }
        removeRegistered();
        if (registration === currentRegistration) registration = null;
        documentListener = null; popstateListener = null;
        throw error;
      }
    };
    const stop = () => {
      if (!active) return;
      active = false; generation += 1;
      const oldDocument = documentListener;
      const oldPopstate = popstateListener;
      const currentRegistration = registration;
      documentListener = null; popstateListener = null;
      registration = null;
      let failed = false;
      if (currentRegistration === null || (currentRegistration.documentMayBeRegistered
        && !currentRegistration.documentRemoved)) {
        if (currentRegistration !== null) currentRegistration.documentRemoved = true;
        try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, oldDocument); } catch { failed = true; }
      }
      if (currentRegistration === null || (currentRegistration.globalMayBeRegistered
        && !currentRegistration.globalRemoved)) {
        if (currentRegistration !== null) currentRegistration.globalRemoved = true;
        try { globalScope.removeEventListener('popstate', oldPopstate); } catch { failed = true; }
      }
      if (failed && (currentRegistration === null || currentRegistration.complete)) {
        report(new Error('Unable to stop X navigation observer'));
      }
    };
    const getCurrentUrl = () => {
      if (!active) throw new TypeError('X navigation observer is not active');
      return location.href;
    };
    const isActive = () => active;
    return Object.freeze({ start, stop, getCurrentUrl, isActive });
  }

  const X_PAGE_RUNTIME_REQUEST_EVENT_TYPE =
    'x-region-block:page-runtime-request';

  const X_PAGE_RUNTIME_READY_EVENT_TYPE =
    'x-region-block:page-runtime-ready';

  const X_PAGE_RUNTIME_ERROR_EVENT_TYPE =
    'x-region-block:page-runtime-error';

  const X_PAGE_RUNTIME_STOP_EVENT_TYPE =
    'x-region-block:page-runtime-stop';

  const supportedOrigins$1 = new Set(['https://x.com', 'https://twitter.com']);

  function usableRuntime(namespace) {
    try { return typeof namespace?.runtime?.getURL === 'function' ? namespace.runtime : null; }
    catch { return null; }
  }

  function createXPageScriptInjector(globalScope) {
    let dependencies;
    try {
      const { document, Event, Promise: PromiseConstructor, MutationObserver } = globalScope;
      const origin = globalScope.location.origin;
      const add = document.addEventListener;
      const remove = document.removeEventListener;
      const dispatch = document.dispatchEvent;
      const createElement = document.createElement;
      const runtime = usableRuntime(globalScope.browser) ?? usableRuntime(globalScope.chrome);
      const getURL = runtime?.getURL;
      if (!supportedOrigins$1.has(origin) || document === null || typeof document !== 'object'
        || typeof Event !== 'function' || typeof PromiseConstructor !== 'function'
        || typeof MutationObserver !== 'function' || typeof add !== 'function'
        || typeof remove !== 'function' || typeof dispatch !== 'function'
        || typeof createElement !== 'function' || typeof getURL !== 'function') throw new Error();
      dependencies = { document, Event, Promise: PromiseConstructor, MutationObserver,
        add, remove, dispatch, createElement, runtime, getURL };
    } catch { throw new TypeError('Invalid X page script injector global scope'); }

    let active = false;
    let generation = 0;
    let pending = null;
    const createEvent = (type) => new dependencies.Event(type, {
      bubbles: false, cancelable: false, composed: false,
    });
    const owned = (state) => pending === state && generation === state.lifecycle && !state.claimed;
    const removeScript = (script) => {
      try { script.remove(); }
      catch { try { script.parentNode?.removeChild(script); } catch { /* best effort */ } }
    };
    const cleanup = (state) => {
      if (state.readyMayBeAdded) {
        state.readyMayBeAdded = false;
        try { Reflect.apply(dependencies.remove, dependencies.document,
          [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]); } catch { /* best effort */ }
      }
      if (state.errorMayBeAdded) {
        state.errorMayBeAdded = false;
        try { Reflect.apply(dependencies.remove, dependencies.document,
          [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]); } catch { /* best effort */ }
      }
      const observer = state.observer;
      state.observer = null;
      try { observer?.disconnect(); } catch { /* best effort */ }
      const script = state.script;
      state.script = null;
      if (script) {
        try { script.onload = null; } catch { /* best effort */ }
        try { script.onerror = null; } catch { /* best effort */ }
        removeScript(script);
      }
    };
    const settle = (state, success) => {
      if (state.settled) return;
      state.settled = true;
      cleanup(state);
      if (pending === state) pending = null;
      if (success && !state.claimed && generation === state.lifecycle) {
        active = true;
        state.resolve();
      } else {
        active = false;
        state.reject(new Error('Unable to inject X page runtime'));
      }
    };

    const start = () => {
      if (pending !== null) return pending.promise;
      if (active) return dependencies.Promise.resolve();
      const state = {
        lifecycle: generation + 1, claimed: false, settled: false, probeDispatched: false,
        readyMayBeAdded: false, errorMayBeAdded: false, observer: null, script: null,
        resolve: null, reject: null, ready: null, error: null, promise: null,
      };
      state.promise = new dependencies.Promise((resolve, reject) => {
        state.resolve = resolve; state.reject = reject;
      });
      generation = state.lifecycle;
      pending = state;
      state.ready = () => { if (owned(state)) settle(state, true); };
      state.error = () => { if (owned(state)) settle(state, false); };
      const checkpoint = () => {
        if (!owned(state)) throw new Error('startup claimed');
      };
      const insert = () => {
        checkpoint();
        const root = dependencies.document.documentElement;
        checkpoint();
        if (root === null || root === undefined) return false;
        if (typeof root.appendChild !== 'function') throw new Error('invalid insertion root');
        const observer = state.observer;
        state.observer = null;
        try { observer?.disconnect(); } catch { /* insertion can continue */ }
        checkpoint();
        Reflect.apply(root.appendChild, root, [state.script]);
        if (!owned(state)) { removeScript(state.script); checkpoint(); }
        return true;
      };
      try {
        state.readyMayBeAdded = true;
        Reflect.apply(dependencies.add, dependencies.document,
          [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]);
        if (!owned(state)) {
          try { Reflect.apply(dependencies.remove, dependencies.document,
            [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]); } catch { /* best effort */ }
        }
        checkpoint();
        state.errorMayBeAdded = true;
        Reflect.apply(dependencies.add, dependencies.document,
          [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]);
        if (!owned(state)) {
          try { Reflect.apply(dependencies.remove, dependencies.document,
            [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]); } catch { /* best effort */ }
        }
        checkpoint();
        state.probeDispatched = true;
        Reflect.apply(dependencies.dispatch, dependencies.document,
          [createEvent(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE)]);
        checkpoint();
        const url = Reflect.apply(dependencies.getURL, dependencies.runtime, ['page/page-script.js']);
        checkpoint();
        if (typeof url !== 'string' || !/^(?:chrome|moz)-extension:/.test(url)) throw new Error();
        const script = Reflect.apply(dependencies.createElement, dependencies.document, ['script']);
        checkpoint();
        if (script === null || (typeof script !== 'object' && typeof script !== 'function')) throw new Error();
        state.script = script;
        script.src = url;
        checkpoint();
        script.async = false;
        checkpoint();
        script.onerror = () => { if (owned(state)) settle(state, false); };
        checkpoint();
        script.onload = () => {
          if (!owned(state)) return;
          dependencies.Promise.resolve().then(() => {
            if (owned(state)) settle(state, false);
          });
        };
        checkpoint();
        if (!insert()) {
          const observer = new dependencies.MutationObserver(() => {
            if (!owned(state)) return;
            try { insert(); } catch { if (owned(state)) settle(state, false); }
          });
          if (!owned(state)) { try { observer.disconnect(); } catch { /* best effort */ } }
          checkpoint();
          state.observer = observer;
          observer.observe(dependencies.document, { childList: true });
          checkpoint();
          insert();
        }
      } catch { if (!state.settled) settle(state, false); }
      return state.promise;
    };

    const stop = () => {
      const state = pending;
      const shouldSignal = active || state?.probeDispatched === true;
      active = false;
      generation += 1;
      if (state !== null) {
        state.claimed = true;
        settle(state, false);
      }
      if (shouldSignal) {
        try { Reflect.apply(dependencies.dispatch, dependencies.document,
          [createEvent(X_PAGE_RUNTIME_STOP_EVENT_TYPE)]); } catch { /* best effort */ }
      }
    };
    return Object.freeze({ start, stop, isActive: () => active });
  }

  const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);

  function createDiagnostic(globalScope) {
    const last = new Map();
    return (code, level = 'info') => {
      const now = Date.now();
      if (now - (last.get(code) ?? 0) < 30_000) return;
      last.set(code, now);
      try { globalScope.console?.[level]?.(`[X Region Reveal & Block] ${code}`); } catch { /* local only */ }
    };
  }
  const DIAGNOSTICS = Object.freeze({
    DISCOVERY: 'Account target discovery failed.', PAGE_BRIDGE: 'About Account request bridge unavailable.',
    METADATA: 'About Account metadata handling failed.', QUEUE: 'About Account request queue failed.',
    HTTP_400: 'About Account request was rejected (HTTP 400).', HTTP_401: 'About Account authentication metadata rejected.',
    HTTP_403: 'About Account authentication metadata rejected.', HTTP_404: 'About Account query ID rejected.',
    HTTP_429: 'About Account lookup rate limited; scheduler cooldown started.', HTTP_5XX: 'About Account server request failed.',
    NETWORK: 'About Account network request failed.', INVALID_RESPONSE: 'About Account response was invalid.',
    INVALID_PAYLOAD: 'About Account response payload was invalid.', PARSING: 'About Account payload parsing failed.',
    PRESENTATION: 'Account target presentation failed.', ROUTE: 'Account route processing failed.',
    CLEANUP: 'Account processing cleanup failed.', UNKNOWN: 'Account processing failed.',
  });

  function diagnosticCategory(error) {
    const code = typeof error?.code === 'string' ? error.code : '';
    if (Object.hasOwn(DIAGNOSTICS, code)) return code;
    if (code === 'PAGE_BRIDGE_UNAVAILABLE') return 'PAGE_BRIDGE';
    if (code === 'NO_METADATA') return 'METADATA';
    const message = typeof error?.message === 'string' ? error.message : '';
    if (/metadata/i.test(message)) return 'METADATA';
    if (/discover|target change/i.test(message)) return 'DISCOVERY';
    if (/present/i.test(message)) return 'PRESENTATION';
    if (/parse/i.test(message)) return 'PARSING';
    if (/route|navigation/i.test(message)) return 'ROUTE';
    if (/stop|clean|cancel/i.test(message)) return 'CLEANUP';
    if (/broker|queue|load account/i.test(message)) return 'QUEUE';
    return 'UNKNOWN';
  }

  function usableExtensionApi(namespace) {
    try {
      const { runtime, storage } = namespace ?? {};
      return typeof runtime?.getURL === 'function' && typeof storage?.local?.get === 'function'
        && typeof storage.local.set === 'function' && typeof storage.local.remove === 'function'
        && typeof storage?.onChanged?.addListener === 'function'
        && typeof storage.onChanged.removeListener === 'function' ? namespace : null;
    } catch { return null; }
  }

  function createXProductionContentRuntime(globalScope) {
    let dependencies;
    try {
      const origin = globalScope.location.origin;
      const document = globalScope.document;
      const { MutationObserver, AbortController, Event, URLSearchParams,
        Promise: PromiseConstructor } = globalScope;
      const globalAdd = globalScope.addEventListener;
      const globalRemove = globalScope.removeEventListener;
      const documentAdd = document.addEventListener;
      const documentRemove = document.removeEventListener;
      const documentDispatch = document.dispatchEvent;
      const extensionApi = usableExtensionApi(globalScope.browser)
        ?? usableExtensionApi(globalScope.chrome);
      if (!supportedOrigins.has(origin) || typeof document.querySelectorAll !== 'function'
        || typeof MutationObserver !== 'function' || typeof AbortController !== 'function'
        || typeof Event !== 'function'
        || typeof URLSearchParams !== 'function' || typeof PromiseConstructor !== 'function'
        || typeof globalAdd !== 'function' || typeof globalRemove !== 'function'
        || typeof documentAdd !== 'function' || typeof documentRemove !== 'function'
        || typeof documentDispatch !== 'function' || extensionApi === null) throw new Error();
      dependencies = { origin, document, MutationObserver, AbortController, Event,
        URLSearchParams, Promise: PromiseConstructor,
        CustomEvent: globalScope.CustomEvent ?? class extends Event {
          constructor(type, init = {}) { super(type, init); this.detail = init.detail; }
        },
        globalAdd, globalRemove, documentAdd, documentRemove,
        resolveFlagAssetUrl: (countryCode) => extensionApi.runtime.getURL(
          `assets/flags/${normalizeCountryCode(countryCode).toLowerCase()}.png`,
        ) };
    } catch { throw new TypeError('Invalid X production runtime global scope'); }

    let active = false;
    let ready = false;
    let generation = 0;
    let pending = null;
    let lifecycle = null;
    const diagnostic = createDiagnostic(globalScope);
    const report = (error) => {
      const category = diagnosticCategory(error);
      diagnostic(DIAGNOSTICS[category], 'warn');
    };

    const owned = (state) => lifecycle === state && active && !state.claimed
      && generation === state.generation;
    const stopComponent = (state, key, stoppedKey = `${key}Stopped`) => {
      const value = state[key];
      state[key] = null;
      if (value === null || state[stoppedKey]) return;
      state[stoppedKey] = true;
      try { value.stop(); } catch { /* contained */ }
    };
    const removeMetadata = (state) => {
      const listener = state.metadataListener;
      state.metadataListener = null;
      const mayBeAdded = state.metadataMayBeAdded;
      state.metadataMayBeAdded = false;
      if (!mayBeAdded || listener === null) return;
      try { Reflect.apply(dependencies.documentRemove, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, listener]); } catch { /* contained */ }
    };
    const removePagehide = (state) => {
      const listener = state.pagehideListener;
      state.pagehideListener = null;
      const mayBeAdded = state.pagehideMayBeAdded;
      state.pagehideMayBeAdded = false;
      if (!mayBeAdded || listener === null) return;
      try { Reflect.apply(dependencies.globalRemove, globalScope,
        ['pagehide', listener]); } catch { /* contained */ }
    };
    const cleanup = (state) => {
      if (state.cleaned) return;
      state.cleaned = true;
      removeMetadata(state);
      stopComponent(state, 'routeCandidate');
      stopComponent(state, 'routeController', 'routeCandidateStopped');
      stopComponent(state, 'transport');
      stopComponent(state, 'bridge');
      stopComponent(state, 'settingsCandidate');
      stopComponent(state, 'settingsRuntime');
      stopComponent(state, 'injector');
      removePagehide(state);
      state.metadataCheckPending = false;
      state.prerequisitesReady = false;
    };
    const rejectStartup = (state) => {
      if (state.promiseSettled) return;
      state.promiseSettled = true;
      const reject = state.reject;
      state.resolve = null; state.reject = null;
      reject(new Error('Unable to start X production runtime'));
    };
    const fail = (state) => {
      state.claimed = true;
      if (lifecycle === state) {
        active = false; ready = false; lifecycle = null; generation += 1;
      }
      if (pending === state) pending = null;
      cleanup(state);
      rejectStartup(state);
      report();
    };

    const startRoute = (state) => {
      if (!owned(state) || ready || state.routeStarting || !state.prerequisitesReady
        || !state.bridge?.hasSnapshot()) return;
      state.routeStarting = true;
      let candidate = null;
      try {
        const recoveryState = typeof state.bridge.getRecoveryState === 'function'
          ? state.bridge.getRecoveryState() : undefined;
        const transport = createXAboutAccountPageTransport({
          document: dependencies.document, CustomEvent: dependencies.CustomEvent,
        }, {
          recoveryState,
          onMetadataRejected: (kind, revision, rejectedValue) =>
            state.bridge.invalidateRecovery?.(kind, revision, rejectedValue),
        });
        if (!owned(state)) throw new Error();
        state.transport = transport;
        candidate = createXAccountTargetRouteSessionController(dependencies.document, {
          settingsRuntime: state.settingsRuntime,
          observerFactory: (callback) => new dependencies.MutationObserver(callback),
          loadPayload: transport.loadPayload,
          brokerAbortControllerFactory: () => new dependencies.AbortController(),
          consumerAbortControllerFactory: () => new dependencies.AbortController(),
          navigationObserverFactory: (options) => {
            if (options.version !== ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION) {
              throw new TypeError('Invalid navigation observer version');
            }
            return createXNavigationObserver(globalScope, {
              onNavigate: options.onNavigate, onError: options.onError,
            });
          },
          onError: report,
          baseUrl: dependencies.origin,
          resolveFlagAssetUrl: dependencies.resolveFlagAssetUrl,
        });
        state.routeCandidate = candidate;
        if (!owned(state)) { stopComponent(state, 'routeCandidate'); return; }
        const discovered = candidate.start();
        if (!owned(state)) { stopComponent(state, 'routeCandidate'); return; }
        state.routeController = candidate; state.routeCandidate = null;
        ready = true;
        diagnostic('Metadata accepted and account processing started.');
        if (Array.isArray(discovered) && discovered.length === 0) diagnostic('Account discovery is awaiting dynamic targets.');
      } catch {
        if (candidate !== null && state.routeCandidate === null) state.routeCandidate = candidate;
        stopComponent(state, 'routeCandidate');
        if (owned(state)) fail(state);
      } finally { state.routeStarting = false; }
    };

    const stop = () => {
      const state = lifecycle;
      if (state === null) return;
      state.claimed = true;
      active = false; ready = false; generation += 1;
      lifecycle = null;
      if (pending === state) pending = null;
      cleanup(state);
      rejectStartup(state);
    };

    const start = () => {
      if (pending !== null) return pending.promise;
      if (active) return dependencies.Promise.resolve();
      const state = {
        generation: generation + 1, claimed: false, cleaned: false, promiseSettled: false,
        resolve: null, reject: null, promise: null, bridge: null, injector: null,
        settingsCandidate: null, settingsRuntime: null, transport: null,
        routeCandidate: null, routeController: null,
        bridgeStopped: false, injectorStopped: false, settingsCandidateStopped: false,
        settingsRuntimeStopped: false, routeCandidateStopped: false,
        metadataListener: null, metadataMayBeAdded: false,
        metadataCheckPending: false, pagehideListener: null, pagehideMayBeAdded: false,
        prerequisitesReady: false, routeStarting: false,
      };
      state.promise = new dependencies.Promise((resolve, reject) => {
        state.resolve = resolve; state.reject = reject;
      });
      generation = state.generation;
      lifecycle = state;
      pending = state;
      active = true; ready = false;
      diagnostic('Waiting for X GraphQL authentication metadata.');
      const checkpoint = () => { if (!owned(state)) throw new Error('startup claimed'); };
      state.metadataListener = () => {
        if (!owned(state) || state.metadataCheckPending) return;
        state.metadataCheckPending = true;
        dependencies.Promise.resolve().then(() => {
          state.metadataCheckPending = false;
          if (owned(state)) {
            const recoveryState = state.bridge && typeof state.bridge.getRecoveryState === 'function'
              ? state.bridge.getRecoveryState() : null;
            if (recoveryState !== null) state.transport?.updateRecoveryState(recoveryState);
            if (!ready) startRoute(state);
          }
        });
      };
      state.pagehideListener = (event) => { if (event.persisted !== true && owned(state)) stop(); };
      try {
        const facade = Object.assign(Object.create(null), {
          location: { origin: dependencies.origin }, document: dependencies.document,
          Event: dependencies.Event, URLSearchParams: dependencies.URLSearchParams,
        });
        const bridge = createXAboutAccountRequestMetadataBridge(facade, { onError: report });
        state.bridge = bridge;
        if (!owned(state)) stopComponent(state, 'bridge');
        checkpoint();
        bridge.start();
        checkpoint();
        state.metadataMayBeAdded = true;
        const metadataListener = state.metadataListener;
        Reflect.apply(dependencies.documentAdd, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener]);
        if (!owned(state)) {
          try { Reflect.apply(dependencies.documentRemove, dependencies.document,
            [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener]); } catch { /* contained */ }
        }
        checkpoint();
        state.pagehideMayBeAdded = true;
        const pagehideListener = state.pagehideListener;
        Reflect.apply(dependencies.globalAdd, globalScope, ['pagehide', pagehideListener]);
        if (!owned(state)) {
          try { Reflect.apply(dependencies.globalRemove, globalScope,
            ['pagehide', pagehideListener]); } catch { /* contained */ }
        }
        checkpoint();
        const injector = createXPageScriptInjector(globalScope);
        state.injector = injector;
        if (!owned(state)) stopComponent(state, 'injector');
        checkpoint();
        const injectionPromise = injector.start();
        checkpoint();
        const settingsPromise = initializeContentSettings(globalScope);
        const guardedSettings = dependencies.Promise.resolve(settingsPromise).then((settings) => {
          if (!owned(state)) {
            try { settings?.stop(); } catch { /* contained */ }
            throw new Error('startup claimed');
          }
          state.settingsCandidate = settings;
          if (!owned(state)) {
            stopComponent(state, 'settingsCandidate');
            throw new Error('startup claimed');
          }
          return settings;
        });
        checkpoint();
        dependencies.Promise.all([injectionPromise, guardedSettings]).then(([, settings]) => {
          if (!owned(state)) { stopComponent(state, 'settingsCandidate'); return; }
          if (settings === null) { fail(state); return; }
          if (state.settingsCandidate !== settings) { fail(state); return; }
          state.settingsRuntime = settings;
          state.settingsCandidate = null;
          state.settingsRuntimeStopped = state.settingsCandidateStopped;
          if (!owned(state)) { stopComponent(state, 'settingsRuntime'); return; }
          state.prerequisitesReady = true;
          startRoute(state);
          if (!owned(state)) return;
          if (pending === state) pending = null;
          if (!state.promiseSettled) {
            state.promiseSettled = true;
            const resolve = state.resolve;
            state.resolve = null; state.reject = null;
            resolve();
          }
        }, () => { if (owned(state)) fail(state); });
      } catch { if (owned(state)) fail(state); }
      return state.promise;
    };

    return Object.freeze({ start, stop, isActive: () => active, isReady: () => ready });
  }

  const key = Symbol.for('x-region-block.content-runtime.v1');
  let runtime = null;
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    try { runtime?.stop(); } catch { /* contained */ }
    try { if (globalThis[key] === runtime) delete globalThis[key]; } catch { /* contained */ }
    globalThis.console?.error?.('Unable to initialize X Region Reveal & Block');
  };
  try {
    runtime = globalThis[key];
    if (!runtime?.isActive?.()) {
      runtime = createXProductionContentRuntime(globalThis);
      Object.defineProperty(globalThis, key, {
        value: runtime, configurable: true, writable: true, enumerable: false,
      });
    }
    Promise.resolve(runtime.start()).catch(fail);
  } catch { fail(); }

})();
