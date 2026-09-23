import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The vendored ds2-core is the upstream's bytes, not a fork (tsunagi-m-stack section 5).
 *
 * scripts/verify-ds2-core-sync.mjs also compares against the upstream checkout where one exists;
 * this test answers the half that is always answerable: was the copy in THIS repository edited?
 * Same rule as the script: sha256 over LF-normalised text, so CRLF and LF checkouts agree.
 */

const WEB = join(__dirname, '..');
const VENDORED = join(WEB, 'packages', 'ds2-core');

function files(dir: string): string[] {
  const out = ['package.json'];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(join(dir, 'src'));
  return out.sort();
}

const lfHash = (p: string) =>
  createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

describe('vendored @tsunagi/ds2-core', () => {
  const manifest = JSON.parse(readFileSync(join(WEB, 'packages', 'VENDOR.json'), 'utf8'))['ds2-core'] as {
    commit: string;
    files: Record<string, string>;
  };

  it('records a commit and at least the package entry point', () => {
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.files['src/index.ts']).toBeDefined();
  });

  it('carries exactly the files the manifest names, byte for byte', () => {
    expect(files(VENDORED)).toEqual(Object.keys(manifest.files).sort());
    for (const [f, h] of Object.entries(manifest.files)) {
      expect(lfHash(join(VENDORED, f)), f).toBe(h);
    }
  });
});
