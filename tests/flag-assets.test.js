import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../src/shared/country-regions.js';
import {
  FLAG_COUNT, FLAG_MAX_HEIGHT, FLAG_MIN_HEIGHT, FLAG_WIDTH, flagAssetPaths,
  flagFilenames, inspectFlagPng, validateFlagAssets,
} from '../scripts/flag-assets.js';

const temporary = [];
afterEach(async () => Promise.all(temporary.splice(0).map((root) => rm(root, {
  recursive: true, force: true,
}))));

describe('bundled country flag asset policy', () => {
  it('validates the exact canonical inventory, PNG headers, byte size, and observed dimensions', async () => {
    const flags = await validateFlagAssets();
    expect(COUNTRY_CODES).toHaveLength(FLAG_COUNT);
    expect(flags).toHaveLength(249);
    expect(flagFilenames).toHaveLength(249);
    expect(flagAssetPaths).toHaveLength(249);
    expect(flagFilenames).not.toContain('xk.png');
    expect(flags.reduce((total, flag) => total + flag.bytes, 0)).toBe(48_341);
    expect(new Set(flags.map(({ width }) => width))).toEqual(new Set([FLAG_WIDTH]));
    expect(Math.min(...flags.map(({ height }) => height))).toBe(FLAG_MIN_HEIGHT);
    expect(Math.max(...flags.map(({ height }) => height))).toBe(FLAG_MAX_HEIGHT);
    expect(flags.map(({ name }) => name)).toEqual(flagFilenames);
  });

  it('rejects malformed headers and dimensions deterministically', async () => {
    const source = await readFile('src/assets/flags/us.png');
    expect(() => inspectFlagPng(Buffer.alloc(24), 'bad.png')).toThrow(/signature/);
    const width = Buffer.from(source); width.writeUInt32BE(19, 16);
    expect(() => inspectFlagPng(width, 'bad.png')).toThrow(/20 pixels wide/);
    const height = Buffer.from(source); height.writeUInt32BE(25, 20);
    expect(() => inspectFlagPng(height, 'bad.png')).toThrow(/invalid height/);
  });

  it('rejects unexpected files and symbolic links', async () => {
    const unexpected = await mkdtemp(path.join(os.tmpdir(), 'flags-extra-'));
    temporary.push(unexpected);
    await cp('src/assets/flags', unexpected, { recursive: true });
    await writeFile(path.join(unexpected, 'xk.png'), await readFile('src/assets/flags/us.png'));
    await expect(validateFlagAssets(unexpected)).rejects.toThrow(/unexpected: xk.png/);

    const linked = await mkdtemp(path.join(os.tmpdir(), 'flags-link-'));
    temporary.push(linked);
    await cp('src/assets/flags', linked, { recursive: true });
    await rm(path.join(linked, 'us.png'));
    await symlink(path.resolve('src/assets/flags/us.png'), path.join(linked, 'us.png'));
    await expect(validateFlagAssets(linked)).rejects.toThrow(/symbolic flag assets/);
  });
});
