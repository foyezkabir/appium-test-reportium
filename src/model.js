/**
 * model.js: the runner-neutral shape every adapter produces and the renderer
 * consumes. Nothing in here knows about Jest, Mocha, WebdriverIO or JUnit XML.
 *
 * To support a new runner, write a function that returns a `Run`.
 */

/**
 * @typedef {'passed' | 'failed' | 'skipped' | 'pending' | 'todo'} TestStatus
 */

/**
 * @typedef {object} Test
 * @property {string} title Test name without its describe blocks, e.g. 'TC01: logs in'.
 *   Failure artefacts pair to a test by slug(title).
 * @property {string} fullName Describe blocks + title, space-joined. Steps pair
 *   to a test by this, falling back to `title`.
 * @property {string[]} group Describe-block path the test sits in; the report
 *   groups rows by it.
 * @property {TestStatus} status
 * @property {number} [duration] Milliseconds.
 * @property {string[]} errors Raw failure messages with stack traces.
 */

/**
 * @typedef {object} Suite
 * @property {string} file Spec file (or suite name when the file is unknown).
 * @property {Test[]} tests
 * @property {string} [error] Set when the suite crashed before any test ran.
 */

/**
 * @typedef {object} Run
 * @property {number} startTime Epoch milliseconds.
 * @property {number} [duration] Wall-clock milliseconds. Defaults to now − startTime.
 * @property {number} [workers] Parallel workers, when the runner reports it.
 * @property {Suite[]} suites
 */

/**
 * @typedef {object} ReportOptions
 * @property {string} [outputDirectory] Where the report is written and where
 *   steps.jsonl and failures/ are read from. Defaults to $TESTREPORTIUM_DIR,
 *   then 'appium-reports'.
 * @property {string} [filename] Defaults to 'report.html'.
 * @property {string} [pageTitle] Browser tab title. Defaults to '<projectName> · Test Report'.
 * @property {Record<string, string | undefined>} [context] Label → value rows
 *   for the Environment block. Each row overrides the same row recorded from
 *   the live session by recordSession(), which overrides the APPIUM_PLATFORM /
 *   _FRAMEWORK / _DEVICE_NAME / _APP_ID env vars. Extra labels are added.
 * @property {string} [projectName] Name in the top bar. Defaults to $TESTREPORTIUM_PROJECT,
 *   then the "name" in ./package.json.
 * @property {string | false} [historyFile] Where run history is kept. Defaults to
 *   <outputDirectory>/testreportium-history.json; false turns history off.
 * @property {number} [maxHistoryRuns] Runs kept in the history. Default 10.
 * @property {import('./history.js').HistoryRun[]} [historyRuns] Use these earlier runs instead of reading historyFile.
 * @property {number} [flakyThreshold] Flakiness score (0–1) that counts as flaky. Default 0.3.
 * @property {number} [slowerThreshold] Relative slow-down that counts as a regression. Default 0.2.
 * @property {import('./history.js').QualityGates} [qualityGates] Rules shown on the Overview.
 * @property {boolean | { threshold?: number, maxQuarantined?: number, outputFile?: string }} [quarantine]
 *   Write quarantine.json listing flaky tests. The Overview panel shows regardless.
 * @property {number} [maxVideoSize] Largest failure recording (bytes) embedded in the report.
 *   Default 10 MB; a bigger one is named in the report instead of embedded.
 * @property {string} [locale] Locale for the run timestamp. Defaults to the system's.
 * @property {string} [timeZone] Time zone for the run timestamp. Defaults to the system's.
 */

export {};
