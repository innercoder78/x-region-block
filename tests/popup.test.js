import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('popup messaging', () => {
  it('describes the implemented location-only pre-release behavior without stale placeholders', async () => {
    const html = await readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
    expect(html).toMatch(/country X reports/i);
    expect(html).toMatch(/broad region/i);
    expect(html).toMatch(/show, highlight, or hide/i);
    expect(html).toMatch(/pre-release testing build/i);
    expect(html).not.toMatch(/foundation is installed|features are not implemented/i);
  });
});
