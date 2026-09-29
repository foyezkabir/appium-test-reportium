export { renderReport, writeReport, generateReport } from './render.js';
export { loadHistory, analyzeTests, evaluateGates } from './history.js';
export { fromJUnit } from './adapters/junit.js';
export { fromJest } from './adapters/jest.js';
export { captureFailure } from './capture.js';
export { recordTest, finishRecording } from './record.js';
export { recordSession, describeSession, frameworkFromApp, frameworkFromFiles } from './session.js';
export { StepRecorder } from './step-recorder.js';
export { slug } from './slug.js';
export { defaultOutputDirectory } from './paths.js';

// Types, for a typed config: `{ ... } satisfies ReportOptions` in jest.config.ts
// autocompletes every option and flags a misspelt rule or a wrong value.
/** @typedef {import('./model.js').ReportOptions} ReportOptions */
/** @typedef {import('./history.js').QualityGates} QualityGates */
/** @typedef {import('./model.js').Run} Run */
/** @typedef {import('./model.js').Suite} Suite */
/** @typedef {import('./model.js').Test} Test */
/** @typedef {import('./model.js').TestStatus} TestStatus */
/** @typedef {import('./history.js').HistoryRun} HistoryRun */
