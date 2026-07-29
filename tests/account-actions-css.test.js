import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('account action CSS', () => {
  it('contains the owned actions and proportional local flag presentation rules', async () => {
    const css = await readFile('src/content/account-actions.css', 'utf8');
    expect(css).toContain("[data-x-region-block-account-action='hide']");
    expect(css).toContain('.x-region-block-location-country-flag');
    expect(css).toMatch(/max-width:\s*16px/);
    expect(css).toMatch(/max-height:\s*12px/);
    expect(css).toMatch(/width:\s*auto/);
    expect(css).toMatch(/height:\s*auto/);
    expect(css).toContain('object-fit: contain');
    expect(css).toMatch(/\.x-region-block-post-location-header \.x-region-block-location-country\s*\{[^}]*width:\s*auto[^}]*height:\s*auto[^}]*flex:\s*0 1 auto[^}]*overflow:\s*visible/s);
    expect(css).toMatch(/\.x-region-block-sidebar-item\s*\{[^}]*color:\s*inherit/s);
    expect(css).toMatch(/\.x-region-block-sidebar-icon\s*\{[^}]*color:\s*rgb\(244, 33, 46\)/s);
    expect(css).toMatch(/\.x-region-block-post-location-header \.x-region-block-location-separator\s*\{[^}]*margin-inline:\s*4px/s);
    expect(css).toMatch(/\.x-region-block-post-location-header \.x-region-block-location-vpn-proxy-text\s*\{[^}]*color:\s*#FF0000/s);
    expect(css.match(/color:\s*#FF0000/g)).toHaveLength(1);
    expect(css).not.toMatch(/\.x-region-block-location-(?:separator|segment)\s*\{[^}]*#FF0000/s);
    expect(css).not.toMatch(/show|data-testid|\.css-|visibility|background|transition/);
  });
});
