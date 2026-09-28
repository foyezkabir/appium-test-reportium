/**
 * capture.js: save the device screen at the moment a test fails.
 *
 * On a physical device you cannot see what the screen looked like when a test
 * failed, and the stack trace rarely says. Call this from your runner's
 * failure hook, BEFORE teardown navigates away: it writes a screenshot and the
 * page source, named so the report pairs them with the test automatically.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slug } from './slug.js';
import { defaultOutputDirectory } from './paths.js';
import { recordSession } from './session.js';

/**
 * @typedef {object} Capturable A WebdriverIO browser / Appium client.
 * @property {() => Promise<string>} takeScreenshot Base64 PNG.
 * @property {() => Promise<string>} getPageSource
 */

/**
 * Each capture is independent: a failed screenshot must not prevent the page
 * source, and neither must ever throw: masking the real test failure would be
 * worse than losing the picture.
 *
 * @param {Capturable} driver
 * @param {string} testTitle The test's own title (not the full describe path).
 * @param {{ outputDirectory?: string }} [options]
 */
export async function captureFailure(driver, testTitle, options = {}) {
  // A run that only ever calls captureFailure still gets its Environment block.
  await recordSession(/** @type {any} */ (driver), options);
  const dir = join(options.outputDirectory ?? defaultOutputDirectory(), 'failures');
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn(`[testreportium] capture skipped: ${e.message}`);
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(dir, `${stamp}__${slug(testTitle)}`);

  try {
    writeFileSync(`${base}.png`, Buffer.from(await driver.takeScreenshot(), 'base64'));
  } catch (e) {
    console.warn(`[testreportium] screenshot failed: ${e.message}`);
  }
  try {
    writeFileSync(`${base}.xml`, await driver.getPageSource());
  } catch (e) {
    console.warn(`[testreportium] page source failed: ${e.message}`);
  }
}
