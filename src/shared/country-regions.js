import { REGIONS, REGION_CODES } from './regions.js';

export const COUNTRY_REGION_POLICY_VERSION = 1;

export const COUNTRY_CODES = Object.freeze(
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
export const COUNTRY_REGION_CODES = Object.freeze(
  Object.fromEntries(
    Object.entries(countryGroups).flatMap(([regionCode, countries]) =>
      countries.split(',').map((countryCode) => [countryCode, REGION_CODES[regionCode]]),
    ),
  ),
);

const supportedCountryCodes = new Set(COUNTRY_CODES);

export function normalizeCountryCode(value) {
  if (typeof value !== 'string') throw new TypeError('Unsupported country code');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || !supportedCountryCodes.has(code)) {
    throw new TypeError('Unsupported country code');
  }
  return code;
}

export function isSupportedCountryCode(value) {
  try {
    normalizeCountryCode(value);
    return true;
  } catch {
    return false;
  }
}

export function getCountryRegionCode(value) {
  if (!isSupportedCountryCode(value)) return null;
  return COUNTRY_REGION_CODES[normalizeCountryCode(value)];
}

export function getCountryRegion(value) {
  const regionCode = getCountryRegionCode(value);
  return regionCode === null ? null : REGIONS[regionCode];
}
