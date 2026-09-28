/**
 * Filesystem-safe name from a test title.
 *
 * The ONE definition shared by the writer (captureFailure) and the reader
 * (renderReport). If the two ever drifted, every screenshot would silently
 * stop pairing with its test. The report would still build, just without
 * images. Import this; never copy it.
 *
 * @param {string} s
 * @returns {string}
 */
export const slug = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
