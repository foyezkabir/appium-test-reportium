/**
 * The directory every part of testreportium agrees on: StepRecorder and
 * captureFailure write into it, the renderer reads from it and writes the
 * report next to them. Set TESTREPORTIUM_DIR once to move all of it.
 *
 * @returns {string}
 */
export const defaultOutputDirectory = () => process.env.TESTREPORTIUM_DIR || 'appium-reports';
