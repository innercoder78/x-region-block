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
    expect(css).not.toMatch(/show|data-testid|\.css-|visibility|background|transition/);
  });
});
