/**
 * Runs against dist/, what actually ships. `npm test` builds first.
 *
 * The fixtures are a real captured run: junit.xml, steps.jsonl and failures/.
 * Regenerate the golden file after an intended visual change with:
 *   UPDATE_GOLDEN=1 npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fromJUnit, fromJest, renderReport, slug } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures');
const GOLDEN = join(FIX, 'expected-report.html');
const xml = readFileSync(join(FIX, 'junit.xml'), 'utf8');

const OPTS = {
  outputDirectory: FIX,
  pageTitle: 'Orders · Appium Automation Report',
  projectName: 'Orders App',
  historyFile: false,
  context: { Platform: 'Android / iOS', Framework: 'Auto-detected', Device: 'Real or emulator', App: 'com.example.app' },
  locale: 'en-US',
  timeZone: 'UTC',
};

test('JUnit adapter reads counts, statuses and describe groups', () => {
  const run = fromJUnit(xml);
  const tests = run.suites.flatMap((s) => s.tests);
  assert.equal(tests.length, 9);
  assert.equal(tests.filter((t) => t.status === 'failed').length, 7);
  assert.equal(tests.filter((t) => t.status === 'skipped').length, 1);
  assert.deepEqual([...new Set(tests.map((t) => t.group[0]))], ['Orders: creation and validation', 'Explainer coverage']);
  assert.equal(run.startTime, Date.parse('2026-09-25T15:54:52Z'));
  assert.equal(run.duration, 4164);
});

test('JUnit adapter decodes entities and keeps the stack trace', () => {
  const tc03 = fromJUnit(xml).suites[0].tests.find((t) => t.title.startsWith('TC03'));
  assert.match(tc03.errors[0], /^Error: waitForText timed out after 15000ms: "Code already exists"\n\s+at /);
});

test('JUnit adapter handles CDATA, message attributes and multiple files', () => {
  const wdio = `<testsuites><testsuite name="login" timestamp="2026-01-01T00:00:00" time="2">
    <testcase classname="login" name="rejects bad password" time="1.5">
      <failure message="element (&quot;~Error&quot;) still not displayed after 5000ms"><![CDATA[Error: element ("~Error") still not displayed after 5000ms
    at login.e2e.ts:12:3]]></failure></testcase></testsuite></testsuites>`;
  const second = `<testsuite name="cart" timestamp="2026-01-01T00:00:01" time="3"><testcase name="adds item" time="3"/></testsuite>`;
  const run = fromJUnit([wdio, second]);
  const [a, b] = run.suites;
  assert.equal(a.tests[0].errors[0], 'Error: element ("~Error") still not displayed after 5000ms\n    at login.e2e.ts:12:3');
  assert.equal(b.tests[0].status, 'passed');
  assert.equal(run.duration, 4000, 'parallel files: wall-clock span, not the sum');
  assert.match(renderReport(run, { outputDirectory: tmpdir() }), /never reached the required state/);
});

test('Jest adapter produces the same shape', () => {
  const run = fromJest({
    startTime: 0,
    testResults: [{
      testFilePath: join(process.cwd(), 'tests/a.spec.ts'),
      testResults: [{ title: 'TC01: x', fullName: 'A TC01: x', ancestorTitles: ['A'], status: 'passed', duration: 5, failureMessages: [] }],
    }],
  }, { workers: 1 });
  assert.equal(run.suites[0].file, join('tests', 'a.spec.ts'));
  assert.deepEqual(run.suites[0].tests[0], { title: 'TC01: x', fullName: 'A TC01: x', group: ['A'], status: 'passed', duration: 5, errors: [] });
});

test('report makes zero network requests', () => {
  const html = renderReport(fromJUnit(xml), OPTS);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  // CSS url() only; \b keeps Export's URL.createObjectURL( from matching.
  assert.doesNotMatch(html, /\burl\(\s*['"]?(?!data:|#)/i);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|new WebSocket|navigator\.sendBeacon/);
  for (const [, url] of html.matchAll(/\b(?:src|href|srcset|poster)\s*=\s*"([^"]*)"/gi)) {
    assert.match(url, /^(data:|#)/, `external reference: ${url}`);
  }
});

test('report is self-contained: embeds every screenshot, references no local file', () => {
  const html = renderReport(fromJUnit(xml), OPTS);
  const failed = fromJUnit(xml).suites.flatMap((s) => s.tests).filter((t) => t.status === 'failed');
  assert.equal(html.match(/src="data:image\/png;base64,/g)?.length, failed.length);
  assert.ok(!html.includes(FIX), 'report must not point back at the fixture directory');
  assert.ok(!html.includes('failures/'), 'report must not reference artefact paths');
});

test('steps pair to their test by full name', () => {
  const html = renderReport(fromJUnit(xml), OPTS);
  assert.equal(html.match(/class="block sec steps"/g)?.length, 2);
  assert.match(html, /open Orders tab/);
});

test('every inline script parses (a syntax error silently kills filters, views and export)', () => {
  const html = renderReport(fromJUnit(xml), OPTS);
  const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));
  const data = html.match(/<script type="application\/json" id="trdata">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(data).tests.length, 9);
});

test('slug is the one shared definition', () => {
  assert.equal(slug('TC03: Duplicate code is rejected with a message'), 'TC03_Duplicate_code_is_rejected_with_a_message');
});

test('CLI writes the report into --out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testreportium-'));
  cpSync(join(FIX, 'failures'), join(dir, 'failures'), { recursive: true });
  const out = execFileSync(process.execPath, [join(here, '../dist/cli.js'), join(FIX, 'junit.xml'), '-o', dir], { encoding: 'utf8' });
  assert.match(out, /report: .*report\.html/);
  assert.equal(readFileSync(join(dir, 'report.html'), 'utf8').match(/data:image\/png/g)?.length, 7);
});

test('golden file', () => {
  const html = renderReport(fromJUnit(xml), OPTS);
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, html);
  const want = readFileSync(GOLDEN, 'utf8');
  if (html === want) return;
  // Point at the first difference; dumping 170 KB of HTML helps nobody.
  let i = 0;
  while (html[i] === want[i]) i++;
  assert.fail(`report differs from the golden file at offset ${i}:\n  got:  …${html.slice(Math.max(0, i - 60), i + 80)}\n  want: …${want.slice(Math.max(0, i - 60), i + 80)}\nIf the change is intended: UPDATE_GOLDEN=1 npm test`);
});
