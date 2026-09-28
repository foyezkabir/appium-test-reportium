/**
 * History is what makes the report smart, and it must never invent a value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeTests, evaluateGates, generateReport, renderReport } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'testreportium-'));

/** A run with the given { name: [status, ms] } tests, one suite. */
const mkRun = (startTime, tests) => ({
  startTime, duration: 1000,
  suites: [{ file: 'login.e2e', tests: Object.entries(tests).map(([title, [status, duration]]) => ({ title, fullName: `Login ${title}`, group: ['Login'], status, duration, errors: status === 'failed' ? [`Error: ${title} broke`] : [] })) }],
});
const past = (startTime, tests) => ({
  startTime, duration: 1000, flaky: 0,
  passed: Object.values(tests).filter(([s]) => s === 'passed').length,
  failed: Object.values(tests).filter(([s]) => s === 'failed').length,
  skipped: Object.values(tests).filter(([s]) => s === 'skipped').length,
  tests: Object.fromEntries(Object.entries(tests).map(([t, v]) => [`login.e2e::Login ${t}`, v])),
});

test('first run: every history value is absent, never estimated', () => {
  const ins = analyzeTests([{ key: 'a', st: 'failed', duration: 500 }], []);
  assert.deepEqual({ ...ins.get('a'), past: undefined }, {
    past: undefined, flakiness: undefined, health: 'new', newFailure: false, fixed: false, avg: undefined, change: undefined, slower: false,
  });
});

test('flaky, new failure, fixed, failing and regression are told apart', () => {
  const runs = [
    { startTime: 1, tests: { flaky: ['passed', 100], broke: ['passed', 100], fixed: ['failed', 100], always: ['failed', 100], slow: ['passed', 1000] } },
    { startTime: 2, tests: { flaky: ['failed', 100], broke: ['passed', 100], fixed: ['failed', 100], always: ['failed', 100], slow: ['passed', 1000] } },
  ];
  const ins = analyzeTests([
    { key: 'flaky', st: 'passed', duration: 100 },
    { key: 'broke', st: 'failed', duration: 100 },
    { key: 'fixed', st: 'passed', duration: 100 },
    { key: 'always', st: 'failed', duration: 100 },
    { key: 'slow', st: 'passed', duration: 1600 },
  ], runs);
  assert.equal(ins.get('flaky').health, 'flaky');
  assert.equal(Math.round(ins.get('flaky').flakiness * 100), 33);
  assert.equal(ins.get('broke').newFailure, true);
  assert.equal(ins.get('fixed').fixed, true);
  assert.equal(ins.get('always').health, 'failing', 'always failing is broken, not flaky');
  assert.equal(ins.get('slow').slower, true);
  assert.equal(Math.round(ins.get('slow').change * 100), 60);
});

test('tiny absolute slow-downs are not regressions', () => {
  const ins = analyzeTests([{ key: 'x', st: 'passed', duration: 9 }], [{ startTime: 1, tests: { x: ['passed', 3] } }]);
  assert.equal(ins.get('x').slower, false);
});

test('quality gates evaluate every configured rule', () => {
  const g = evaluateGates({ maxFailures: 5, minPassRate: 60, maxFlakyRate: 30, noNewFailures: true, minStabilityGrade: 'B' },
    { failed: 3, passRate: 79, flakyRate: 4, grade: 'C', newFailures: 0, hasHistory: true });
  assert.equal(g.passed, false);
  assert.deepEqual(g.rules.map((r) => [r.label, r.passed, `${r.actual} ${r.limit}`.trim()]), [
    ['Max failures', true, '3 ≤ 5'], ['Min pass rate', true, '79% ≥ 60%'], ['Max flaky rate', true, '4% ≤ 30%'],
    ['Min stability grade', false, 'C ≥ B'], ['No new failures', true, '0 new failures'],
  ]);
  assert.equal(evaluateGates(undefined, {}), null, 'no gates configured → no panel');
  const first = evaluateGates({ noNewFailures: true }, { newFailures: 0, hasHistory: false });
  assert.equal(first.rules[0].skipped, true, 'first run cannot claim "no new failures"');
});

test('generateReport keeps a history and the second report uses it', () => {
  const dir = tmp();
  generateReport(mkRun(1_000, { a: ['passed', 200], b: ['passed', 300], c: ['passed', 2000] }), { outputDirectory: dir, projectName: 'Demo' });
  const r2 = generateReport(mkRun(2_000, { a: ['failed', 200], b: ['passed', 300], c: ['passed', 3000], d: ['passed', 50] }), {
    outputDirectory: dir, projectName: 'Demo', qualityGates: { maxFailures: 0, noNewFailures: true }, quarantine: true,
  });
  const hist = JSON.parse(readFileSync(join(dir, 'testreportium-history.json'), 'utf8'));
  assert.equal(hist.runs.length, 2);
  assert.equal(r2.gates.passed, false);
  assert.deepEqual(r2.gates.rules.map((r) => r.passed), [false, false]);
  assert.ok(existsSync(join(dir, 'quarantine.json')));

  const html = readFileSync(r2.file, 'utf8');
  assert.match(html, /New failures<\/span>/, 'attention card');
  assert.match(html, /Performance regressions<\/span>/);
  assert.match(html, /Quality Gates/);
  const cmp = html.slice(html.indexOf('id="v-comparison"'), html.indexOf('id="v-gallery"'));
  assert.match(cmp, /Execution telemetry matrix[\s\S]*Previous \(Run #1\)[\s\S]*This run \(Run #2\)/);
  assert.match(cmp, /<tr class="worse">[\s\S]*?Failed[\s\S]*?<span class="dbadge bad strong">↑1<\/span>/, 'failures up: filled red badge');
  assert.match(cmp, /<h4>New failures<\/h4><span class="dcount">1<\/span>/);
  assert.match(cmp, /<h4>New tests<\/h4><span class="dcount">1<\/span>[\s\S]*?Not in run #1/);
  assert.match(cmp, /<h4>Fixed<\/h4><span class="dcount">0<\/span>[\s\S]*?No test that failed last run passes now/, 'empty card explains itself');
  assert.match(cmp, /<h4>Slower<\/h4><span class="dcount">1<\/span>[\s\S]*?2.00s → 3.00s[\s\S]*?\+1.00s/);
  assert.match(html, /class="rtable"/, 'trends table');
  assert.match(html, /Run history <span class="muted">\(last 2 runs\)/);
  assert.doesNotMatch(html, /appear from the second run/);
});

test('comparison: a skipped test is never listed as faster or slower', () => {
  const html = renderReport(mkRun(10_000, { a: ['skipped', 0], b: ['passed', 100] }), {
    outputDirectory: tmp(), historyFile: false, historyRuns: [past(1_000, { a: ['passed', 900], b: ['passed', 100] })],
  });
  const cmp = html.slice(html.indexOf('id="v-comparison"'), html.indexOf('id="v-gallery"'));
  assert.match(cmp, /<h4>Faster<\/h4><span class="dcount">0<\/span>/);
  assert.match(cmp, /<h4>Slower<\/h4><span class="dcount">0<\/span>/);
});

test('re-rendering the same run never compares it with itself or double-counts', () => {
  const dir = tmp();
  const run = mkRun(5_000, { a: ['passed', 100] });
  generateReport(run, { outputDirectory: dir });
  generateReport(run, { outputDirectory: dir });
  assert.equal(JSON.parse(readFileSync(join(dir, 'testreportium-history.json'), 'utf8')).runs.length, 1);
  assert.match(readFileSync(join(dir, 'report.html'), 'utf8'), /Trends appear from the second run/);
});

test('history keeps only the newest maxHistoryRuns', () => {
  const dir = tmp();
  for (let i = 1; i <= 5; i++) generateReport(mkRun(i * 1000, { a: ['passed', 100] }), { outputDirectory: dir, maxHistoryRuns: 3 });
  const runs = JSON.parse(readFileSync(join(dir, 'testreportium-history.json'), 'utf8')).runs;
  assert.deepEqual(runs.map((r) => r.startTime), [3000, 4000, 5000]);
});

test('historyRuns option and flaky tile', () => {
  const html = renderReport(mkRun(10_000, { a: ['passed', 100] }), {
    outputDirectory: tmp(), historyFile: false,
    historyRuns: [past(1, { a: ['failed', 100] }), past(2, { a: ['passed', 100] }), past(3, { a: ['failed', 100] })],
  });
  assert.match(html, /class="tile yellow" data-f="att" data-v="flaky"><b>1<\/b>/);
  assert.match(html, /Quarantine/);
});

test('top bar shows the project name, a breadcrumb and Export', () => {
  const html = renderReport(mkRun(1, { a: ['passed', 1] }), { outputDirectory: tmp(), historyFile: false, projectName: 'Acme Mobile QA' });
  assert.match(html, /<div class="brand"><b>Acme Mobile QA<\/b>/);
  assert.match(html, /<nav class="crumb"[^>]*><a href="#overview">Tests<\/a><span class="sep">›<\/span><span id="crumb">Overview<\/span>/);
  assert.match(html, /data-exp="json"[\s\S]*data-exp="csv"[\s\S]*data-exp="print"/);
  assert.match(html, /<title>Acme Mobile QA · Test Report<\/title>/);
});

test('CLI --fail-on-gate exits 1 when a gate fails', () => {
  const dir = tmp();
  const cli = join(here, '../dist/cli.js');
  const junit = join(here, 'fixtures', 'junit.xml');
  const ok = spawnSync(process.execPath, [cli, junit, '-o', dir, '--max-failures', '100', '--fail-on-gate'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /quality gates: PASSED/);
  const bad = spawnSync(process.execPath, [cli, junit, '-o', dir, '--max-failures', '0', '--fail-on-gate'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /✕ Max failures: 7 ≤ 0/);
  assert.equal(execFileSync(process.execPath, [cli, junit, '-o', dir, '--max-failures', '0'], { encoding: 'utf8' }).includes('FAILED'), true, 'without --fail-on-gate it only reports');
});

test('sparkline dots explain each run: date, pass rate, change, counts, gate verdict, flaky names', () => {
  const html = renderReport(mkRun(10_000, { a: ['failed', 100], b: ['passed', 100] }), {
    outputDirectory: tmp(), historyFile: false, timeZone: 'UTC', locale: 'en-US',
    qualityGates: { maxFailures: 0, noNewFailures: true },
    historyRuns: [past(1_000, { a: ['passed', 100], b: ['failed', 100] }), past(2_000, { a: ['passed', 100], b: ['passed', 100] })],
  });
  const tips = [...html.matchAll(/class="spt[^"]*"[^>]*data-tip="([^"]*)"/g)].map((m) => m[1].replace(/&#39;/g, "'"));
  const gate = tips.slice(0, 3);
  assert.equal(gate.length, 3, 'one dot per run');
  assert.match(gate[0], /Pass rate 50%\n1 passed · 1 failed · 0 skipped\nGates: FAILED: Max failures/);
  assert.match(gate[1], /Pass rate 100%  \(▲ 50 pts vs previous\)[\s\S]*Gates: PASSED/);
  assert.match(gate[2], /this run\nPass rate 50%  \(▼ 50 pts vs previous\)[\s\S]*Gates: FAILED: Max failures, No new failures\nNew failures: 1/);
  const flaky = tips.slice(3);
  assert.match(flaky[2], /this run\n2 flaky of 2 tests \(100%\)  ·  \+[12] vs previous\nLogin a\nLogin b/);
  assert.match(html, /<h4>Pass rate trend \(last 3 runs\)<\/h4>/);
  assert.match(html, /class="rule no"[\s\S]*Max failures[\s\S]*Condition: ≤ 0 failures allowed/);
  assert.match(html, /<span class="qrun">Run #3<\/span><span class="qbadge"><i><\/i>Gate failed<\/span>/);
  assert.match(html, /Quarantine Registry[\s\S]*Flaky test volume \(last 3 runs\)[\s\S]*Target: 0 flaky/);
  assert.match(html, /Failed in 1\/3 runs/, 'per-candidate history, this run included');
});
