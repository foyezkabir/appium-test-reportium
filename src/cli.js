#!/usr/bin/env node
/**
 * testreportium <junit.xml...>: build the report from JUnit XML after any run.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromJUnit } from './adapters/junit.js';
import { generateReport } from './render.js';

const USAGE = `Usage: testreportium <junit.xml...> [options]

Builds one self-contained report.html from JUnit XML written by any runner
(WebdriverIO, Mocha, Jest, pytest, ...). Steps, failure screenshots and the
run history are read from the output directory when present.

Options:
  -o, --out <dir>          output directory, also where steps.jsonl, failures/
                           and the history are read from
                           (default: $TESTREPORTIUM_DIR or appium-reports)
  -p, --project <name>     name in the top bar (default: package.json name)
  -f, --filename <f>       report file name (default: report.html)
  -t, --title <text>       browser tab title (default: "<project> · Test Report")
      --no-history         do not read or update testreportium-history.json
      --max-history <n>    runs kept in the history (default: 10)

Quality gates (shown on the Overview; exit code 1 with --fail-on-gate):
      --max-failures <n>
      --min-pass-rate <pct>
      --max-flaky-rate <pct>
      --min-grade <A|B|C|D>
      --no-new-failures
      --fail-on-gate       exit 1 when any gate fails (for CI)
      --quarantine         write quarantine.json listing flaky tests
  -h, --help               show this help`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      project: { type: 'string', short: 'p' },
      filename: { type: 'string', short: 'f' },
      title: { type: 'string', short: 't' },
      'no-history': { type: 'boolean' },
      'max-history': { type: 'string' },
      'max-failures': { type: 'string' },
      'min-pass-rate': { type: 'string' },
      'max-flaky-rate': { type: 'string' },
      'min-grade': { type: 'string' },
      'no-new-failures': { type: 'boolean' },
      'fail-on-gate': { type: 'boolean' },
      quarantine: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  console.error(`${e.message}\n\n${USAGE}`);
  process.exit(2);
}

const { values: v, positionals } = args;
if (v.help || !positionals.length) {
  console.log(USAGE);
  process.exit(v.help ? 0 : 2);
}

const num = (name) => {
  if (v[name] === undefined) return undefined;
  const n = Number(v[name]);
  if (!Number.isFinite(n)) {
    console.error(`testreportium: --${name} must be a number, got "${v[name]}"`);
    process.exit(2);
  }
  return n;
};
if (v['min-grade'] && !/^[ABCD]$/.test(v['min-grade'])) {
  console.error('testreportium: --min-grade must be A, B, C or D');
  process.exit(2);
}

const gates = Object.fromEntries(Object.entries({
  maxFailures: num('max-failures'),
  minPassRate: num('min-pass-rate'),
  maxFlakyRate: num('max-flaky-rate'),
  minStabilityGrade: v['min-grade'],
  noNewFailures: v['no-new-failures'] || undefined,
}).filter(([, x]) => x !== undefined));

try {
  const run = fromJUnit(positionals.map((f) => readFileSync(f, 'utf8')));
  const { file, gates: result } = generateReport(run, {
    outputDirectory: v.out,
    projectName: v.project,
    filename: v.filename,
    pageTitle: v.title,
    historyFile: v['no-history'] ? false : undefined,
    maxHistoryRuns: num('max-history'),
    qualityGates: Object.keys(gates).length ? gates : undefined,
    quarantine: v.quarantine || undefined,
  });
  console.log(`report: ${file}`);
  if (result) {
    for (const r of result.rules) console.log(`  ${r.skipped ? '–' : r.passed ? '✓' : '✕'} ${r.label}: ${[r.actual, r.limit].filter(Boolean).join(' ')}`);
    console.log(`quality gates: ${result.passed ? 'PASSED' : 'FAILED'}`);
    if (!result.passed && v['fail-on-gate']) process.exit(1);
  }
} catch (e) {
  console.error(`testreportium: ${e.message}`);
  process.exit(1);
}
