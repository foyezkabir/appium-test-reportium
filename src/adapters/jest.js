/**
 * Jest adapter. Use as a reporter:
 *
 *   reporters: ['default', ['testreportium/jest', { pageTitle: 'My App' }]]
 *
 * Options are ReportOptions (see model.js).
 */

import { relative } from 'node:path';
import { generateReport } from '../render.js';

/** @typedef {import('../model.js').Run} Run */
/** @typedef {import('../model.js').ReportOptions} ReportOptions */

/**
 * Convert Jest's AggregatedResult into a Run.
 *
 * @param {any} results Jest's AggregatedResult.
 * @param {{ workers?: number }} [extra]
 * @returns {Run}
 */
export function fromJest(results, extra = {}) {
  return {
    startTime: results.startTime,
    duration: Date.now() - results.startTime,
    workers: extra.workers,
    suites: results.testResults.map((s) => ({
      file: relative(process.cwd(), s.testFilePath),
      error: s.testResults.length ? undefined : (s.failureMessage || (s.testExecError && String(s.testExecError.message ?? s.testExecError)) || undefined),
      tests: s.testResults.map((t) => ({
        title: t.title,
        fullName: t.fullName,
        group: t.ancestorTitles ?? [],
        status: t.status,
        duration: t.duration ?? undefined,
        errors: t.failureMessages ?? [],
      })),
    })),
  };
}

export default class TestreportiumJestReporter {
  /**
   * @param {any} globalConfig
   * @param {ReportOptions} [options]
   */
  constructor(globalConfig, options = {}) {
    this._workers = globalConfig?.maxWorkers;
    this._o = options;
  }

  onRunComplete(_contexts, results) {
    try {
      const { file, gates } = generateReport(fromJest(results, { workers: this._workers }), this._o);
      console.log(`\n  report: ${file}`);
      if (gates) console.log(`  quality gates: ${gates.passed ? 'PASSED' : `FAILED (${gates.rules.filter((r) => !r.passed).map((r) => r.label).join(', ')})`}`);
    } catch (e) {
      // Reporting must never fail a run: the tests already ran.
      console.warn(`[testreportium] report not written: ${e.message}`);
    }
  }
}
