import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('account action CSS', () => {
  it('contains only the exact owned hide and highlight rules', async () => {
    const css = await readFile('src/content/account-actions.css', 'utf8');
    expect(css).toBe(`[data-x-region-block-account-action='hide'] {\n  display: none !important;\n}\n\n[data-x-region-block-account-action='highlight'] {\n  outline: 2px solid Highlight !important;\n  outline-offset: -2px !important;\n}\n`);
    expect(css.match(/\{/g)).toHaveLength(2);
    expect(css).not.toMatch(/show|data-testid|\.css-|visibility|background|transition/);
  });
});
