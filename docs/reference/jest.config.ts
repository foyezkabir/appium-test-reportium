/**
 * jest.config.ts: committed, so every clone runs with the same reporters.
 * The HTML report comes from the testreportium Jest adapter.
 */

export default {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // ── Invariants for a real-device Appium suite. ─────────────────────────
  maxWorkers: 1,        // one physical device
  bail: 0,              // one run must surface EVERY failure
  testTimeout: 240_000, // every command is an HTTP round trip + a bridge call
  // NO jest.retryTimes; see the flake policy. A test that passes on rerun
  // with no code change is a defect in the test.

  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  reporters: [
    'default',

    // Machine-readable. CI tooling parses this junit.xml, so never remove it,
    // and never change outputDirectory/outputName without updating CI.
    ['jest-junit', {
      outputDirectory: 'appium-reports',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
    }],

    // Human-readable: testreportium. Produces ONE self-contained report.html
    // with failure screenshots embedded as base64, so it can be attached to a
    // ticket and still render.
    ['testreportium/jest', {
      pageTitle: '<App name> · Appium Automation Report',
      filename: 'report.html',
    }],
  ],
};
