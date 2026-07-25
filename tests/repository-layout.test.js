import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };

async function exists(path) {
  return access(path).then(() => true, () => false);
}

describe('repository layout', () => {
  it.each([
    'config/eslint.config.js',
    'config/rollup.config.js',
    'package.json',
    'package-lock.json',
    'LICENSE',
  ])('keeps %s in its expected location', async (path) => {
    await expect(exists(path)).resolves.toBe(true);
  });

  it.each([
    'eslint.config.js',
    'rollup.config.js',
  ])('does not keep %s at the repository root', async (path) => {
    await expect(exists(path)).resolves.toBe(false);
  });

  it('uses the relocated configuration files in package scripts', () => {
    expect(packageJson.scripts.lint).toBe('eslint --config config/eslint.config.js .');
    expect(packageJson.scripts['build:chrome']).toBe(
      'rollup --config config/rollup.config.js --environment BROWSER:chrome',
    );
    expect(packageJson.scripts['build:firefox']).toBe(
      'rollup --config config/rollup.config.js --environment BROWSER:firefox',
    );
  });
});
