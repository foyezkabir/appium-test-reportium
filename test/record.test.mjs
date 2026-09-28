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
  assert.match(html, /<div class="gitem both">[\s\S]*<em>Screenshot<\/em>[\s\S]*<video controls preload="metadata" playsinline data-from="t1"><\/video><em>Recording<\/em>/);
  assert.match(html, /Gallery <span class="muted mono">1 screenshot · 1 recording<\/span>/);
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
