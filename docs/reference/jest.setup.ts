/**
 * jest.setup.ts: standing infrastructure, loaded via setupFilesAfterEnv.
 *
 * On a physical device you cannot see what the screen looked like when a test
 * failed, and the stack trace rarely says. This captures a screenshot plus the
 * page source at the moment of failure, named after the test, into
 * <outputDirectory>/failures/ via testreportium's captureFailure().
 *
 * It wraps the global `it`/`test` rather than using an afterEach, because an
 * afterEach runs AFTER teardown has already navigated away; by then the
 * screen no longer shows the failure.
 */

import { captureFailure, StepRecorder } from 'testreportium';

// Also call `await recordSession(driver)` from 'testreportium' wherever the
// session is created (e.g. src/support/driver.ts), so the report's
// Environment block shows the real device and app even on an all-green run.

async function capture(testName: string) {
  // Imported lazily: at module load the driver does not exist yet.
  let driver;
  try {
    const { d } = await import('./src/support/driver');
    driver = d();
  } catch {
    return; // no live session, nothing to capture, and that is not an error
  }
  // Names the files so the report pairs them with the test. Never throws.
  await captureFailure(driver, testName);
}

/**
 * Wrap the global test fn so a throwing body is captured, then RE-THROWN.
 * Swallowing here would turn every failure green, hiding real defects.
 */
function wrap(original: jest.It): jest.It {
  const wrapped = ((name: string, fn?: jest.ProvidesCallback, timeout?: number) => {
    if (!fn) return original(name, fn as never, timeout);
    const inner = async (...args: unknown[]) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (fn as any)(...args);
      } catch (err) {
        await capture(name);
        throw err; // ALWAYS re-throw
      }
    };
    return original(name, inner as jest.ProvidesCallback, timeout);
  }) as jest.It;

  // Preserve .each / .only / .skip / .todo / .failing.
  return Object.assign(wrapped, original);
}

/**
 * Tell StepRecorder which test is running, so the steps it records pair back
 * to the right test in the report. WITHOUT THIS every step is written with an
 * empty test name and the report's Steps section is silently empty (verified
 * against a fresh clone).
 */
beforeEach(() => {
  StepRecorder.setTest(expect.getState().currentTestName ?? '');
});

global.it = wrap(global.it);
global.test = wrap(global.test);

export {};
