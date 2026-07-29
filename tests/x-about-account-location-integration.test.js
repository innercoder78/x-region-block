import { describe, expect, it } from 'vitest';
import { presentXAccountLink } from '../src/content/account-presentation.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { createLocationDisplayModel } from '../src/shared/location-display.js';
import { evaluateFilterSubject } from '../src/shared/filter-subject.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { parseXAboutAccountLocationPayload } from '../src/shared/x-about-account-location.js';
import { createContainer, snapshot } from './helpers/fake-dom.js';

const payload = (value, include = true) => {
  const aboutProfile = include ? { account_based_in: value } : {};
  return { data: { user_result_by_screen_name: { result: { about_profile: aboutProfile } } } };
};
const parse = (value, include) => parseXAboutAccountLocationPayload(payload(value, include));
const identity = { handle: 'OpenAI' };
const settings = (value = {}) => normalizeSettings({ schemaVersion: 2, ...value });
const anchor = () => ({
  tagName: 'A', ownerDocument: { baseURI: 'https://x.com/' },
  getAttribute: (name) => name === 'href' ? '/OpenAI' : null,
});

describe('X About Account location pure-boundary integration', () => {
  it('feeds canonical known locations directly to display and filter evaluation', () => {
    const location = parse('Canada');
    const display = createLocationDisplayModel(location);
    expect(display.country).toMatchObject({ code: 'CA', name: 'Canada' });
    expect(display.region).toBeNull();
    expect(evaluateFilterSubject({ identity, location }, settings({
      country: { hide: ['CA'] }, region: { highlight: ['NORTH_AMERICA'] },
    })).action).toBe('hide');
    expect(evaluateFilterSubject({ identity, location }, settings({
      country: { alwaysShow: ['CA'], hide: ['CA'] }, region: { hide: ['NORTH_AMERICA'] },
    })).action).toBe('show');
    expect(JSON.stringify(display)).not.toMatch(/rawLocation|x-about-account/);
  });

  it('keeps Antarctica known with an unknown region display', () => {
    const display = createLocationDisplayModel(parse('Antarctica'));
    expect(display.status).toBe('known');
    expect(display.country.code).toBe('AQ');
    expect(display.region).toBeNull();
  });

  it('preserves unknown, missing, and unavailable distinctions', () => {
    expect(createLocationDisplayModel(parse('Worldwide')).status).toBe('unknown');
    expect(createLocationDisplayModel(parse(undefined, false)).status).toBe('missing');
    expect(createLocationDisplayModel(parseXAboutAccountLocationPayload({})).status).toBe('unavailable');
  });

  it('presents parsed locations without exposing parser or payload metadata', () => {
    const input = payload(' USA ');
    input.secret = 'payload-secret';
    input.data.user_result_by_screen_name.result.about_profile.source = 'device-secret';
    const location = parseXAboutAccountLocationPayload(input);
    const { container } = createContainer();
    const result = presentXAccountLink(anchor(), container, { location }, settings());
    expect(result.display.country.code).toBe('US');
    expect(findLocationBadge(container).textContent).toBe('US');
    expect(JSON.stringify(snapshot(container))).not.toMatch(/USA|x-about-account|device-secret|payload-secret/);
  });

  it('filters and presents a parsed region-only location as known', () => {
    const location = parse('North America');
    expect(evaluateFilterSubject({ identity, location }, settings({
      region: { hide: ['NORTH_AMERICA'] }, country: { hide: ['US'] },
      other: { hide: ['unknown'] },
    })).action).toBe('hide');
    const { container } = createContainer();
    presentXAccountLink(anchor(), container, { location }, settings());
    expect(findLocationBadge(container).textContent).toBe('🌐 North America');
  });
});
