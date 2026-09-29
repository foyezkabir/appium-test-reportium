/**
 * testreportium is always published as a public package. These guard the
 * settings that keep it that way, so a later edit cannot quietly make a
 * release private or send it to another registry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package is published public, to the public npm registry', () => {
  assert.equal(pkg.private, undefined, '"private": true would block npm publish');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
});

test('package ships only the build and its licences', () => {
  assert.deepEqual(pkg.files, ['dist', 'assets/fonts/OFL-*.txt', 'README.md', 'LICENSE']);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.bin?.testreportium, 'dist/cli.js');
});

test('config types are exported, so a typed jest.config catches a wrong option', () => {
  const dts = readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8');
  for (const t of ['ReportOptions', 'QualityGates', 'Run']) assert.match(dts, new RegExp(`export type ${t} =`), `${t} is exported`);
});
