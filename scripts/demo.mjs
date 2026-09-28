/**
 * Builds demo/report.html from the current code, so every view can be looked
 * at after a change: `npm run demo` (builds first, then opens the report).
 *
 * Uses the repo's fixtures, a stand-in screen recording, and six SIMULATED earlier runs, so the history
 * features (trends, comparison, flaky tests, quality gates, quarantine) have
 * something to show. demo/ is git-ignored and rebuilt from scratch each time.
 */

import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateReport, fromJUnit } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}demo`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync(`${root}test/fixtures/failures`, `${dir}/failures`, { recursive: true });
cpSync(`${root}test/fixtures/steps.jsonl`, `${dir}/steps.jsonl`);

// A stand-in screen recording for three failed tests, so the Gallery shows
// both kinds of card: screenshot + recording, and screenshot only.
for (const tc of ['TC03_Duplicate_code_is_rejected_with_a_message', 'TC10_locator_not_found', 'TC13_tls']) {
  cpSync(`${root}test/fixtures/recording.mp4`, `${dir}/failures/2099-01-01T00-00-00-000Z__${tc}.mp4`);
}
// A kept recording of a passing test, as with finishRecording(..., { keep: true }).
cpSync(`${root}test/fixtures/recording.mp4`, `${dir}/failures/2099-01-01T00-00-00-000Z__TC01_Order_is_created_with_valid_values.mp4`);

const base = fromJUnit(readFileSync(`${root}test/fixtures/junit.xml`, 'utf8'));
const options = {
  outputDirectory: dir,
  projectName: 'Orders App QA',
  // Neutral values: the demo describes the block, not one device.
  context: { Platform: 'Android / iOS', Device: 'Real or emulator', Framework: 'Auto-detected', App: 'com.example.app', Automation: 'UiAutomator2 / XCUITest', Appium: '2.x' },
};

// 1 = passed, 0 = failed, per test in fixture order (the skipped test stays skipped).
const plan = [
  [1, 0, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 0],
];
const now = Date.now();
plan.forEach((outcomes, runIndex) => {
  const run = structuredClone(base);
  run.startTime = now - (plan.length - runIndex) * 86_400_000;
  run.duration = 3000 + runIndex * 150;
  let i = 0;
  for (const suite of run.suites) {
    for (const t of suite.tests) {
      if (t.status !== 'skipped') {
        t.status = outcomes[i] ? 'passed' : 'failed';
        if (outcomes[i]) t.errors = [];
      }
      t.duration = Math.round((t.duration || 200) * (0.55 + runIndex * 0.05));
      i++;
    }
  }
  generateReport(run, options);
});

const run = structuredClone(base);
run.startTime = now;
const { file } = generateReport(run, {
  ...options,
  qualityGates: { maxFailures: 5, minPassRate: 60, maxFlakyRate: 30, noNewFailures: true },
  quarantine: true,
});
console.log(`demo: ${file}`);
