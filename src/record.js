/**
 * record.js: screen recording for failed tests.
 *
 * A screenshot shows where a test ended up; a recording shows how it got
 * there. Start recording before each test, finish after it, and keep the
 * video only when the test failed: a passing test's video is thrown away.
 *
 *   await recordTest(driver);                                  // before each test
 *   await finishRecording(driver, test.title, { keep: failed }); // after each test
 *
 * The video lands next to the failure screenshot, named the same way, so the
 * report pairs it with its test. Like captureFailure, neither call ever
 * throws: losing a recording must never fail or mask a test.
 *
 * Android records with the device's own screen recorder. iOS needs ffmpeg on
 * the machine running Appium.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slug } from './slug.js';
import { defaultOutputDirectory } from './paths.js';

/**
 * @typedef {object} RecordingDriver A WebdriverIO browser / Appium client.
 * @property {(options?: object) => Promise<unknown>} startRecordingScreen
 * @property {() => Promise<string>} stopRecordingScreen Base64 MP4.
 * @property {Record<string, any>} [capabilities]
 */

/** Small, report-friendly defaults: a failure video is evidence, not a film. */
function defaults(driver) {
  const p = String(driver?.capabilities?.platformName ?? driver?.capabilities?.['appium:platformName'] ?? '').toLowerCase();
  if (p === 'ios') return { videoType: 'libx264', videoQuality: 'medium', videoFps: 10, timeLimit: 180 };
  // Android: 2 Mbps at the device's resolution keeps a 30 s clip around 5 MB.
  return { bitRate: 2_000_000, timeLimit: 180 };
}

/**
 * Start recording the device screen. Call before each test.
 *
 * @param {RecordingDriver} driver
 * @param {{ recordingOptions?: object }} [options] Passed to Appium's
 *   startRecordingScreen, over the defaults (see the Appium driver docs).
 * @returns {Promise<boolean>} Whether recording started.
 */
export async function recordTest(driver, options = {}) {
  try {
    await driver.startRecordingScreen({ ...defaults(driver), ...options.recordingOptions });
    return true;
  } catch (e) {
    console.warn(`[testreportium] screen recording not started: ${e.message}`);
    return false;
  }
}

/**
 * Stop recording. Saves the video when `keep` is true (the test failed),
 * otherwise discards it. Call after each test, before the next one starts.
 *
 * @param {RecordingDriver} driver
 * @param {string} testTitle The test's own title (not the full describe path).
 * @param {{ keep?: boolean, outputDirectory?: string }} [options]
 * @returns {Promise<string | undefined>} The saved file, if any.
 */
export async function finishRecording(driver, testTitle, options = {}) {
  let base64;
  try {
    base64 = await driver.stopRecordingScreen();
  } catch (e) {
    console.warn(`[testreportium] screen recording not stopped: ${e.message}`);
    return undefined;
  }
  if (!options.keep || !base64) return undefined;
  try {
    const dir = join(options.outputDirectory ?? defaultOutputDirectory(), 'failures');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}__${slug(testTitle)}.mp4`);
    writeFileSync(file, Buffer.from(base64, 'base64'));
    return file;
  } catch (e) {
    console.warn(`[testreportium] screen recording not saved: ${e.message}`);
    return undefined;
  }
}
