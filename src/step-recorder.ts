/**
 * step-recorder.ts: per-step timings for the HTML report.
 *
 * Test runners hand a reporter only a TOTAL duration per test; there is no
 * step breakdown to read. So steps must be recorded as they happen. Wrap each
 * page-object action in `StepRecorder.step()`, which times the call and
 * appends one line to <outputDirectory>/steps.jsonl. The renderer reads that
 * file and shows the steps under each test.
 *
 * Rules:
 *  - Recording NEVER changes behaviour. The wrapped call's result is returned
 *    untouched and a thrown error is re-thrown after being recorded.
 *  - A recording failure is swallowed. Losing a report line must never fail a
 *    test, because that would make the reporter a source of false findings.
 *  - Steps carry no assertions. This is instrumentation, not a test tier.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOutputDirectory } from './paths.js';

export type StepStatus = 'passed' | 'failed';

export interface StepRecord {
  /** Full test name (describe blocks + title), used to pair a step back to its test. */
  test: string;
  /** What the step did, e.g. 'tap Save button'. */
  title: string;
  /** Milliseconds the step took. */
  ms: number;
  status: StepStatus;
  /** First line of the error, when the step threw. */
  error?: string;
}

export class StepRecorder {
  private static current = '';
  private static dir: string | undefined;

  /** Where steps.jsonl goes. Defaults to $TESTREPORTIUM_DIR, then 'appium-reports'. */
  static configure(options: { outputDirectory?: string }) {
    StepRecorder.dir = options.outputDirectory;
  }

  /** Call before each test with its full name so steps pair to the right one. */
  static setTest(name: string) {
    StepRecorder.current = name;
  }

  /**
   * Time `fn`, record it, return whatever it returned. On a throw, record the
   * failure and RE-THROW; swallowing here would hide a real defect.
   */
  static async step<T>(title: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const out = await fn();
      StepRecorder.write({ test: StepRecorder.current, title, ms: Date.now() - started, status: 'passed' });
      return out;
    } catch (e) {
      StepRecorder.write({
        test: StepRecorder.current,
        title,
        ms: Date.now() - started,
        status: 'failed',
        error: String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300),
      });
      throw e;
    }
  }

  private static write(rec: StepRecord) {
    try {
      const dir = StepRecorder.dir ?? defaultOutputDirectory();
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'steps.jsonl'), `${JSON.stringify(rec)}\n`);
    } catch {
      // Instrumentation must never fail a run.
    }
  }
}
