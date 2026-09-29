/**
 * Failure recordings: saved only for failed tests, never throwing, embedded
 * beside the screenshot up to a size limit, and shown in the Gallery.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { recordTest, finishRecording, renderReport } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'testreportium-'));
const VIDEO = 'AAAAIGZ0eXBpc29t'; // "....ftypisom": a stand-in MP4 payload

const fakeDriver = (over = {}) => {
  const calls = [];
  return { calls, capabilities: { platformName: 'Android' },
    startRecordingScreen: async (o) => { calls.push(['start', o]); },
    stopRecordingScreen: async () => { calls.push(['stop']); return VIDEO; }, ...over };
};

test('a failed test keeps its recording, a passed one discards it', async () => {
  const dir = tmp();
  const d = fakeDriver();
  assert.equal(await recordTest(d), true);
  assert.equal(d.calls[0][1].bitRate, 2_000_000, 'small Android default');
  assert.equal(await finishRecording(d, 'TC01: passes', { keep: false, outputDirectory: dir }), undefined);
  const saved = await finishRecording(d, 'TC02: fails', { keep: true, outputDirectory: dir });
  assert.match(saved, /failures\/.+__TC02_fails\.mp4$/);
  assert.deepEqual(readdirSync(join(dir, 'failures')).map((f) => f.split('__')[1]), ['TC02_fails.mp4']);
});

test('iOS gets its own defaults, and options override them', async () => {
  const d = fakeDriver({ capabilities: { platformName: 'iOS' } });
  await recordTest(d, { recordingOptions: { videoFps: 24 } });
  assert.equal(d.calls[0][1].videoQuality, 'medium');
  assert.equal(d.calls[0][1].videoFps, 24);
});

test('recording problems never throw', async () => {
  const broken = { startRecordingScreen: async () => { throw new Error('no ffmpeg'); }, stopRecordingScreen: async () => { throw new Error('not recording'); } };
  assert.equal(await recordTest(broken), false);
  assert.equal(await finishRecording(broken, 'x', { keep: true, outputDirectory: tmp() }), undefined);
});

const runWith = (dir) => {
  mkdirSync(join(dir, 'failures'), { recursive: true });
  writeFileSync(join(dir, 'failures', '2026-01-01T00-00-00-000Z__TC02_fails.png'), Buffer.from('png'));
  return { startTime: 1, duration: 1, suites: [{ file: 'a.e2e', tests: [
    { title: 'TC02: fails', fullName: 'A TC02: fails', group: ['A'], status: 'failed', duration: 5, errors: ['Error: boom'] },
  ] }] };
};

test('report embeds the recording beside the screenshot, once, and the Gallery pairs them', () => {
  const dir = tmp();
  const run = runWith(dir);
  cpSync(join(here, 'fixtures', 'recording.mp4'), join(dir, 'failures', '2026-01-01T00-00-01-000Z__TC02_fails.mp4'));
  const html = renderReport(run, { outputDirectory: dir, historyFile: false });
  assert.equal(html.match(/src="data:video\/mp4;base64,/g)?.length, 1, 'embedded once; the Gallery reuses it');
  assert.match(html, /<div class="mediarow">[\s\S]*Screenshot ·[\s\S]*<video controls[\s\S]*Recording ·/);
  const gallery = html.slice(html.indexOf('id="v-gallery"'), html.indexOf('id="lb"'));
  assert.match(gallery, /<div class="gmedia both"><button type="button" class="gp gp-shot"[\s\S]*?<span class="gtag shot">Screenshot<\/span>[\s\S]*?<video controls preload="metadata" playsinline data-from="t1"><\/video><span class="gtag rec"><i><\/i>Rec<\/span>/);
  assert.match(gallery, /1 screenshot<\/span>[\s\S]*?1 recording<\/span>[\s\S]*?1 failure capture<\/span>/);
  assert.match(gallery, /data-gf="all">[\s\S]*?All <i>2<\/i>[\s\S]*?Screenshots <i>1<\/i>[\s\S]*?Videos <i>1<\/i>/);
  assert.match(gallery, /<button type="button" class="gp gp-shot" data-lb="img" data-from="t1"/, 'the screenshot opens fullscreen');
  assert.match(html, /"recording":true/);
});

test('a recording over maxVideoSize is named, not embedded', () => {
  const dir = tmp();
  const run = runWith(dir);
  writeFileSync(join(dir, 'failures', '2026-01-01T00-00-01-000Z__TC02_fails.mp4'), Buffer.alloc(2048));
  const html = renderReport(run, { outputDirectory: dir, historyFile: false, maxVideoSize: 1024 });
  assert.doesNotMatch(html, /data:video\/mp4/);
  assert.match(html, /Recording not embedded: 2 KB is over the 1 KB limit \(maxVideoSize\)[\s\S]*__TC02_fails\.mp4/);
});

test('a passed test shows a recording from this run, never a leftover from an earlier run', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'failures'), { recursive: true });
  const start = Date.parse('2026-06-01T10:00:00Z');
  cpSync(join(here, 'fixtures', 'recording.mp4'), join(dir, 'failures', '2026-06-01T10-00-30-000Z__TC01_fresh.mp4'));
  cpSync(join(here, 'fixtures', 'recording.mp4'), join(dir, 'failures', '2026-05-01T10-00-00-000Z__TC02_stale.mp4'));
  writeFileSync(join(dir, 'failures', '2026-06-01T10-00-30-000Z__TC03_passed_shot.png'), Buffer.from('png'));
  const run = { startTime: start, duration: 60_000, suites: [{ file: 'a.e2e', tests: [
    { title: 'TC01: fresh', fullName: 'A TC01: fresh', group: ['A'], status: 'passed', duration: 5, errors: [] },
    { title: 'TC02: stale', fullName: 'A TC02: stale', group: ['A'], status: 'passed', duration: 5, errors: [] },
    { title: 'TC03: passed shot', fullName: 'A TC03: passed shot', group: ['A'], status: 'passed', duration: 5, errors: [] },
  ] }] };
  const html = renderReport(run, { outputDirectory: dir, historyFile: false });
  assert.equal(html.match(/src="data:video\/mp4;base64,/g)?.length, 1, 'only the fresh recording');
  assert.match(html, /<article class="gi-item passed"[^>]*data-vid="1">[\s\S]*?<b>TC01<\/b><span class="gstat">Passed<\/span>/);
  assert.match(html, /Screen recording<\/h4>/, 'a passed test is not labelled "at failure"');
  assert.doesNotMatch(html, /data:image\/png/, 'screenshots only ever belong to failed tests');
});

test('gallery cards name the spec, since TC numbers repeat across specs', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'failures'), { recursive: true });
  writeFileSync(join(dir, 'failures', '2026-01-01T00-00-00-000Z__TC01_login.png'), Buffer.from('png'));
  writeFileSync(join(dir, 'failures', '2026-01-01T00-00-00-000Z__TC01_checkout.png'), Buffer.from('png'));
  const run = { startTime: 1, duration: 1, suites: [
    { file: 'specs/login.e2e.ts', tests: [{ title: 'TC01: login', fullName: 'Login TC01: login', group: ['Login'], status: 'failed', duration: 5, errors: ['Error: a'] }] },
    { file: 'specs/cart.e2e.ts', tests: [{ title: 'TC01: checkout', fullName: 'Cart TC01: checkout', group: ['Cart'], status: 'failed', duration: 5, errors: ['Error: b'] }] },
  ] };
  const gallery = renderReport(run, { outputDirectory: dir, historyFile: false }).split('id="v-gallery"')[1];
  assert.match(gallery, /<b>TC01<\/b>[\s\S]*?<span class="gsuite" title="specs\/login\.e2e\.ts">/);
  assert.match(gallery, /<b>TC01<\/b>[\s\S]*?<span class="gsuite" title="specs\/cart\.e2e\.ts">/);
  assert.match(gallery, /<option value="suite">By suite<\/option>/);
});

test('every capture gets a full card: 10 failures, 10 cards, no second section', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'failures'), { recursive: true });
  const tests = Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    writeFileSync(join(dir, 'failures', `2026-01-01T00-00-00-000Z__TC${n}_case.png`), Buffer.from('png'));
    return { title: `TC${n}: case`, fullName: `Suite TC${n}: case`, group: ['Suite'], status: 'failed', duration: 5, errors: ['Error: x'] };
  });
  const html = renderReport({ startTime: 1, duration: 1, suites: [{ file: 's.e2e', tests }] }, { outputDirectory: dir, historyFile: false });
  const gallery = html.split('id="v-gallery"')[1].split('id="lb"')[0];
  assert.equal(gallery.match(/<div class="gcard">/g)?.length, 10);
  assert.doesNotMatch(gallery, /Additional run captures|class="glist"|class="grow"/);
});
