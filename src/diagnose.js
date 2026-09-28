/**
 * diagnose.js: turn a raw failure into one plain sentence, a concrete next
 * step, and a KIND that says whose problem it probably is.
 *
 * Every rule matches a failure shape Appium suites actually produce. The raw
 * trace is ALWAYS still shown underneath: this explains, it never replaces.
 * When nothing matches we return null rather than inventing a cause, because
 * a confidently wrong diagnosis costs more than none.
 *
 * Kinds:
 *   app      the app did not do what the test required; possibly a real defect
 *   test     the locator or the test's own handling went wrong
 *   env      device, session, network or certificate; not a test result at all
 *   timeout  something hung; the step timings show where
 */

// eslint-disable-next-line no-control-regex
const stripAnsi = (s = '') => String(s).replace(/\u001b\[[0-9;]*m/g, '');

/**
 * @typedef {'app' | 'test' | 'env' | 'timeout'} FailureKind
 * @typedef {{ kind: FailureKind, why: string, next: string }} Diagnosis
 */

/**
 * @param {string} [raw]
 * @returns {Diagnosis | null}
 */
export function explain(raw = '') {
  const m = stripAnsi(raw);
  const first = m.split('\n').find((l) => l.trim()) ?? '';

  // Jest assertion: expected X, received Y.
  const unent = (t) => (t ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const exp = unent(m.match(/Expected:?\s*(.+)/)?.[1]?.trim());
  const got = unent(m.match(/Received:?\s*(.+)/)?.[1]?.trim());

  const quoted = (t) => (t.match(/"([^"]+)"/) || t.match(/'([^']+)'/) || [])[1];

  // --- waits ------------------------------------------------------------
  if (/waitForText[\s\S]*timed out|timed out[\s\S]*waitForText/i.test(m)) {
    const txt = quoted(first);
    return {
      kind: 'app',
      why: `The app never showed the text ${txt ? `“${txt}”` : 'that was expected'} within the wait.`,
      next: 'Either the app did not produce that message (a real defect) or the copy changed. Check the screenshot below against the expected string in the locator file.',
    };
  }
  if (/waitVisible|still displayed|never became visible/i.test(m) && /timed out|timeout/i.test(m)) {
    return {
      kind: 'test',
      why: 'An element that the test waited for never appeared on screen.',
      next: 'Confirm on the screenshot whether the screen even reached the right state. If it did, the locator is stale: re-inspect the live hierarchy.',
    };
  }
  if (/waitGone/i.test(m) && /timed out|timeout/i.test(m)) {
    return {
      kind: 'test',
      why: 'An element that should have disappeared was still on screen when the wait expired.',
      next: 'Usually a dialog, sheet or spinner that did not dismiss. Check whether the preceding action actually completed.',
    };
  }
  // WebdriverIO: "element ("~Save") still not displayed after 5000ms".
  if (/still not (displayed|existing|clickable|enabled) after/i.test(m)) {
    return {
      kind: 'test',
      why: 'An element that the test waited for never reached the required state on screen.',
      next: 'Confirm on the screenshot whether the screen even reached the right state. If it did, the locator is stale: re-inspect the live hierarchy.',
    };
  }

  // --- locators ---------------------------------------------------------
  if (/no such element|NoSuchElement|element wasn'?t found|Can'?t call .* on element/i.test(m)) {
    return {
      kind: 'test',
      why: 'The locator matched nothing on the current screen.',
      next: 'Either the app is on a different screen than expected, or the selector drifted. Note that an element behind a floating bottom nav can report as displayed but not be tappable, so scroll it into reach before tapping.',
    };
  }
  if (/stale element|StaleElementReference/i.test(m)) {
    return {
      kind: 'test',
      why: 'The element handle went stale: the view re-rendered between finding it and using it.',
      next: 'A page object cached a handle instead of exposing a getter. Locators must re-query on every access.',
    };
  }

  // --- session / device -------------------------------------------------
  if (/UiAutomation not connected|IllegalStateException/i.test(m)) {
    return {
      kind: 'env',
      why: 'Appium could not take control of the device: another automation client already holds it.',
      next: 'Android grants the UiAutomation connection to exactly one client. Close the other tool and re-run preflight. This is not a test defect.',
    };
  }
  if (/Trust anchor|NSURLErrorDomain|certificate|SSL|CERT_/i.test(m)) {
    return {
      kind: 'env',
      why: 'The app could not reach its API because the TLS certificate was rejected.',
      next: 'Usually device clock skew, which invalidates every current certificate. Check the device date and time before treating this as an API bug.',
    };
  }
  if (/ECONNREFUSED|socket hang up|connect ETIMEDOUT|Failed to create session/i.test(m)) {
    return {
      kind: 'env',
      why: 'The Appium server could not be reached, or refused to start a session.',
      next: 'Check the Appium server is running and that the device is attached and authorised (adb devices / xcrun simctl list).',
    };
  }
  // Jest: "Exceeded timeout of", Mocha / WebdriverIO: "Timeout of 60000ms exceeded".
  if (/Exceeded timeout of|Async callback was not invoked|Timeout of \d+ms exceeded/i.test(m)) {
    return {
      kind: 'timeout',
      why: 'The test hit the test runner’s timeout before it finished.',
      next: 'A step is hanging rather than failing. The step timings below show which one stalled.',
    };
  }

  // --- plain assertion --------------------------------------------------
  if (exp && got) {
    return {
      kind: 'app',
      why: `The app produced ${got} where the test required ${exp}.`,
      next: 'If the app is right, the expected value is stale, so re-pin it to the app source. If the test is right, this is a product defect worth reporting.',
    };
  }

  return null;
}
