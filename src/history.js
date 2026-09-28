/**
 * history.js: what makes the report "smart": it remembers earlier runs.
 *
 * Each writeReport() appends a compact summary of the run to
 * <outputDirectory>/testreportium-history.json (last `maxHistoryRuns`, default
 * 10). From that the report derives, per test: flakiness, new failures, fixes,
 * performance regressions and a duration trend; per run: deltas, trends, a
 * comparison with the previous run, quality gates and a quarantine list.
 *
 * Nothing here guesses: with no earlier run every history-based value is
 * simply absent ("New"), never estimated.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @typedef {import('./model.js').Run} Run */

/**
 * @typedef {object} HistoryRun
 * @property {number} startTime
 * @property {number} duration
 * @property {number} passed
 * @property {number} failed
 * @property {number} skipped
 * @property {number} flaky
 * @property {Record<string, [string, number | null]>} tests key → [status, ms]
 */

/**
 * @typedef {object} QualityGates
 * @property {number} [maxFailures] Fail the gate above this many failed tests.
 * @property {number} [minPassRate] Percent of executed tests that must pass.
 * @property {number} [maxFlakyRate] Percent of tests allowed to be flaky.
 * @property {'A'|'B'|'C'|'D'} [minStabilityGrade] Lowest acceptable suite grade.
 * @property {boolean} [noNewFailures] Fail when a test that passed last run fails now.
 */

/**
 * @typedef {object} HistoryOptions
 * @property {string | false} [historyFile] Path, or false to disable history.
 * @property {number} [maxHistoryRuns] Default 10.
 * @property {number} [flakyThreshold] Flakiness score counted as flaky (0–1). Default 0.3.
 * @property {number} [slowerThreshold] Relative slow-down counted as a regression. Default 0.2 (20%).
 * @property {QualityGates} [qualityGates]
 * @property {{ threshold?: number, maxQuarantined?: number, outputFile?: string } | boolean} [quarantine]
 */

/** One stable id per test across runs. */
export const testKey = (file, fullName) => `${file}::${fullName}`;

const statusOf = (s) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'skipped');

/** @returns {string | null} */
export function historyPath(dir, options = {}) {
  if (options.historyFile === false) return null;
  return options.historyFile ?? join(dir, 'testreportium-history.json');
}

/**
 * @param {string | null} file
 * @returns {HistoryRun[]}
 */
export function loadHistory(file) {
  if (!file || !existsSync(file)) return [];
  try {
    const h = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(h?.runs) ? h.runs : [];
  } catch {
    return []; // a corrupt history must never break the report
  }
}

/**
 * Compact summary of a run for the history file.
 *
 * @param {Run} run
 * @param {number} [flaky]
 * @returns {HistoryRun}
 */
export function summarize(run, flaky = 0) {
  /** @type {Record<string, [string, number | null]>} */
  const tests = {};
  let passed = 0, failed = 0, skipped = 0;
  for (const s of run.suites) {
    for (const t of s.tests) {
      const st = statusOf(t.status);
      if (st === 'passed') passed++; else if (st === 'failed') failed++; else skipped++;
      tests[testKey(s.file, t.fullName)] = [st, t.duration ?? null];
    }
  }
  return { startTime: run.startTime, duration: run.duration ?? Date.now() - run.startTime, passed, failed, skipped, flaky, tests };
}

/**
 * Append this run (replacing an earlier entry with the same startTime, so a
 * re-render never double-counts) and keep the newest `max`.
 */
export function saveHistory(file, runs, entry, max = 10) {
  if (!file) return;
  const next = [...runs.filter((r) => r.startTime !== entry.startTime), entry]
    .sort((a, b) => a.startTime - b.startTime).slice(-max);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, runs: next }));
}

/**
 * @typedef {object} TestInsight
 * @property {Array<{ s: string, d: number | null, startTime: number }>} past Earlier runs of this test, oldest first.
 * @property {number | undefined} flakiness Failed share of executed runs, this one included (0–1).
 * @property {'new'|'stable'|'unstable'|'flaky'|'failing'|'skipped'} health
 * @property {boolean} newFailure Failed now, passed the previous time it ran.
 * @property {boolean} fixed Passed now, failed the previous time it ran.
 * @property {number | undefined} avg Mean duration of earlier passing/failing runs.
 * @property {number | undefined} change Relative duration change vs avg (0.5 = 50% slower).
 * @property {boolean} slower Counts as a performance regression.
 */

/**
 * Per-test insight from earlier runs. `past` excludes the current run.
 *
 * @param {{ key: string, st: string, duration?: number }[]} tests
 * @param {HistoryRun[]} runs Earlier runs only.
 * @param {HistoryOptions} [options]
 * @returns {Map<string, TestInsight>}
 */
export function analyzeTests(tests, runs, options = {}) {
  const flakyAt = options.flakyThreshold ?? 0.3;
  const slowAt = options.slowerThreshold ?? 0.2;
  const out = new Map();
  for (const t of tests) {
    const past = runs.filter((r) => r.tests[t.key]).map((r) => ({ s: r.tests[t.key][0], d: r.tests[t.key][1], startTime: r.startTime }));
    const executed = [...past.filter((p) => p.s !== 'skipped').map((p) => p.s), ...(t.st === 'skipped' ? [] : [t.st])];
    const fails = executed.filter((s) => s === 'failed').length;
    const flakiness = past.length && executed.length ? fails / executed.length : undefined;
    let health = 'new';
    if (t.st === 'skipped') health = 'skipped';
    else if (flakiness !== undefined) {
      health = fails === executed.length ? 'failing' : flakiness >= flakyAt ? 'flaky' : flakiness >= 0.1 ? 'unstable' : 'stable';
    }
    const lastRan = [...past].reverse().find((p) => p.s !== 'skipped');
    const durs = past.map((p) => p.d).filter((d) => typeof d === 'number' && d > 0);
    const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : undefined;
    const change = avg && t.duration != null && t.st !== 'skipped' ? (t.duration - avg) / avg : undefined;
    out.set(t.key, {
      past,
      flakiness,
      health,
      newFailure: t.st === 'failed' && lastRan?.s === 'passed',
      fixed: t.st === 'passed' && lastRan?.s === 'failed',
      avg,
      change,
      // Ignore noise: a 3ms test "doubling" is not a regression worth a card.
      slower: change !== undefined && change > slowAt && t.duration - avg >= 100,
    });
  }
  return out;
}

const GRADES = { A: 5, B: 4, C: 3, D: 2, F: 1 };

/**
 * @param {QualityGates | undefined} gates
 * @param {{ failed: number, passRate: number, flakyRate: number, grade: string, newFailures: number, hasHistory: boolean }} s
 * @returns {{ passed: boolean, rules: Array<{ label: string, passed: boolean, actual: string, limit: string, skipped?: boolean }> } | null}
 */
export function evaluateGates(gates, s) {
  if (!gates || !Object.keys(gates).length) return null;
  const rules = [];
  if (gates.maxFailures !== undefined) rules.push({ label: 'Max failures', passed: s.failed <= gates.maxFailures, actual: String(s.failed), limit: `≤ ${gates.maxFailures}` });
  if (gates.minPassRate !== undefined) rules.push({ label: 'Min pass rate', passed: s.passRate >= gates.minPassRate, actual: `${s.passRate}%`, limit: `≥ ${gates.minPassRate}%` });
  if (gates.maxFlakyRate !== undefined) rules.push({ label: 'Max flaky rate', passed: s.flakyRate <= gates.maxFlakyRate, actual: `${s.flakyRate}%`, limit: `≤ ${gates.maxFlakyRate}%` });
  if (gates.minStabilityGrade !== undefined) {
    rules.push(s.grade
      ? { label: 'Min stability grade', passed: GRADES[s.grade] >= GRADES[gates.minStabilityGrade], actual: s.grade, limit: `≥ ${gates.minStabilityGrade}` }
      : { label: 'Min stability grade', passed: true, actual: 'not recorded', limit: '', skipped: true });
  }
  if (gates.noNewFailures) {
    rules.push(s.hasHistory
      ? { label: 'No new failures', passed: s.newFailures === 0, actual: `${s.newFailures} new failure${s.newFailures === 1 ? '' : 's'}`, limit: '' }
      : { label: 'No new failures', passed: true, actual: 'first run, nothing to compare', limit: '', skipped: true });
  }
  return { passed: rules.every((r) => r.passed), rules };
}

/**
 * Tests flaky enough to quarantine, worst first. Only mixed pass/fail
 * histories count: a test that always fails is broken, not flaky.
 *
 * @param {Array<{ key: string, title: string, file: string }>} tests
 * @param {Map<string, TestInsight>} insight
 * @param {number} threshold
 */
export function quarantineList(tests, insight, threshold = 0.3) {
  return tests
    .map((t) => ({ ...t, score: insight.get(t.key)?.flakiness }))
    .filter((t) => t.score !== undefined && t.score >= threshold && insight.get(t.key)?.health !== 'failing')
    .sort((a, b) => b.score - a.score);
}

/** @param {string} file */
export function writeQuarantine(file, list, threshold) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    threshold,
    entries: list.map((t) => ({ testId: t.key, title: t.title, file: t.file, flakinessScore: Math.round(t.score * 100) / 100 })),
  }, null, 2));
}
