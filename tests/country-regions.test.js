import { describe, expect, it, vi } from 'vitest';

import {
  COUNTRY_CODES,
  COUNTRY_REGION_CODES,
  COUNTRY_REGION_POLICY_VERSION,
  getCountryRegion,
  getCountryRegionCode,
  isSupportedCountryCode,
  normalizeCountryCode,
} from '../src/shared/country-regions.js';
import { REGIONS, REGION_CODES } from '../src/shared/regions.js';

const expectedCodes = 'AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(',');

const expectedGroups = {
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

describe('country-region policy', () => {
  it('publishes the complete, sorted, immutable ISO registry at policy version 1', () => {
    expect(COUNTRY_REGION_POLICY_VERSION).toBe(1);
    expect(Object.isFrozen(COUNTRY_CODES)).toBe(true);
    expect(COUNTRY_CODES).toEqual(expectedCodes);
    expect(COUNTRY_CODES).toEqual([...COUNTRY_CODES].sort());
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });

  it('maps every supported code exactly once into the explicit policy groups', () => {
    expect(Object.isFrozen(COUNTRY_REGION_CODES)).toBe(true);
    expect(Object.keys(COUNTRY_REGION_CODES).sort()).toEqual(expectedCodes);
    expect(Object.keys(COUNTRY_REGION_CODES)).toHaveLength(249);
    const regionCodes = new Set(Object.values(REGION_CODES));
    expect(Object.values(COUNTRY_REGION_CODES).every((code) => regionCodes.has(code))).toBe(true);
    for (const [regionCode, countries] of Object.entries(expectedGroups)) {
      expect(
        Object.entries(COUNTRY_REGION_CODES)
          .filter(([, mappedRegion]) => mappedRegion === regionCode)
          .map(([country]) => country)
          .sort(),
      ).toEqual(countries.split(',').sort());
    }
    expect(Object.entries(COUNTRY_REGION_CODES).filter(([, code]) => code === 'UNKNOWN')).toEqual([
      ['AQ', 'UNKNOWN'],
    ]);
  });

  it('normalizes supported codes and rejects malformed, alias, and exceptional codes', () => {
    expect(normalizeCountryCode(' ca ')).toBe('CA');
    expect(normalizeCountryCode('gb')).toBe('GB');
    for (const value of ['ZZ', 'UK', 'XK', 'EU', 'AC', 'CP', 'DG', 'EA', 'IC', 'TA', '', 'USA', 1, {}, []]) {
      expect(() => normalizeCountryCode(value)).toThrow(TypeError);
      expect(isSupportedCountryCode(value)).toBe(false);
    }
    expect(isSupportedCountryCode(' aq ')).toBe(true);
  });

  it('returns canonical region records and null safely', () => {
    expect(getCountryRegion('ca')).toBe(REGIONS.NORTH_AMERICA);
    expect(getCountryRegion(' MX ')).toBe(REGIONS.CENTRAL_AMERICA);
    expect(getCountryRegion('AQ')).toBe(REGIONS.UNKNOWN);
    expect(getCountryRegion('ZZ')).toBeNull();
    expect(getCountryRegionCode('aq')).toBe('UNKNOWN');
    expect(getCountryRegionCode(null)).toBeNull();
  });

  it('does not mutate input or invoke browser and scheduling APIs', () => {
    const input = Object.freeze(new String('CA'));
    expect(isSupportedCountryCode(input)).toBe(false);
    const spies = [
      vi.spyOn(globalThis, 'fetch'),
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
    ];
    expect(getCountryRegion('CA')).toBe(REGIONS.NORTH_AMERICA);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
