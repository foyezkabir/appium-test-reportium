# testreportium

Smart, self-contained HTML test reports for Appium scripts. **One file, zero
network calls, zero runtime dependencies.** Failure screenshots are embedded as
base64, so the report can be attached to a ticket, emailed, or opened offline
and still render exactly as it did on the machine that produced it.

Works with any test runner. WebdriverIO, Mocha, Jest, pytest and most others
can write JUnit XML, and testreportium reads that. Jest also has a native
reporter adapter.

> **Status: pre-release.** `package.json` is still `"private": true`. See
> [Publishing](#publishing).

---

## Quick start

### Any runner: from JUnit XML

Point your runner's JUnit reporter at a file, then:

```sh
npx testreportium appium-reports/junit.xml
# report: appium-reports/report.html
```

Several files (WebdriverIO writes one per worker) merge into one report:

```sh
npx testreportium reports/junit/*.xml -o reports -p "My App QA"
```

In CI, fail the job when a quality gate fails:

```sh
npx testreportium reports/junit/*.xml --max-failures 0 --min-pass-rate 95 --no-new-failures --fail-on-gate
```

| Option | Default | |
|---|---|---|
| `-o, --out <dir>` | `$TESTREPORTIUM_DIR` or `appium-reports` | where the report goes; also where `steps.jsonl`, `failures/` and the history live |
| `-p, --project <name>` | `package.json` name | the name in the top bar |
| `-f, --filename <f>` | `report.html` | |
| `-t, --title <text>` | `<project> · Test Report` | browser tab title |
| `--no-history` | | don't read or update the run history |
| `--max-history <n>` | `10` | runs kept in the history |
| `--max-failures <n>` · `--min-pass-rate <pct>` · `--max-flaky-rate <pct>` · `--min-grade <A-D>` · `--no-new-failures` | | [quality gates](#quality-gates-and-quarantine) |
| `--fail-on-gate` | | exit code 1 when a gate fails |
| `--quarantine` | | write `quarantine.json` |

### WebdriverIO

```js
// wdio.conf.js
import { recordSession, captureFailure, StepRecorder, fromJUnit, writeReport } from 'testreportium';
import { readdirSync, readFileSync } from 'node:fs';

export const config = {
  reporters: ['spec', ['junit', { outputDir: 'appium-reports/junit' }]],

  async before() {
    await recordSession(browser); // real device, OS, app, framework → Environment block
  },

  beforeTest(test) {
    // WDIO's JUnit classname is not the bare describe name, so pair by title.
    StepRecorder.setTest(test.title);
  },
  async afterTest(test, _ctx, { passed }) {
    if (!passed) await captureFailure(browser, test.title);
  },
  onComplete() {
    const dir = 'appium-reports/junit';
    const xml = readdirSync(dir).map((f) => readFileSync(`${dir}/${f}`, 'utf8'));
    writeReport(fromJUnit(xml), { projectName: 'My App QA', qualityGates: { maxFailures: 0 } });
  },
};
```

### Jest

```js
// jest.config.js
reporters: [
  'default',
  ['testreportium/jest', { projectName: 'My App QA', qualityGates: { minPassRate: 95 } }],
],
```

Call `await recordSession(driver)` right after you create the session, and see
[`docs/reference/jest.setup.ts`](docs/reference/jest.setup.ts) for capturing
the failure screenshot before teardown navigates away.

### Your own runner

Build a `Run` (see [`src/model.js`](src/model.js)) and hand it to the
renderer:

```js
import { renderReport, writeReport } from 'testreportium';
writeReport(run, { outputDirectory: 'reports' });   // or renderReport(run) → string
```

## Options

Every entry point takes the same `ReportOptions`:

| Option | Default |
|---|---|
| `outputDirectory` | `$TESTREPORTIUM_DIR`, then `appium-reports` |
| `projectName` | `$TESTREPORTIUM_PROJECT`, then the `name` in `./package.json` |
| `filename` | `report.html` |
| `pageTitle` | `<projectName> · Test Report` |
| `historyFile` | `<outputDirectory>/testreportium-history.json`; `false` turns history off |
| `maxHistoryRuns` | `10` |
| `flakyThreshold` | `0.3`, the failure share across runs that counts as flaky |
| `slowerThreshold` | `0.2`, i.e. 20% slower than the test's average (and ≥ 100 ms) counts as a regression |
| `qualityGates` | none; see [Quality gates](#quality-gates-and-quarantine) |
| `quarantine` | off; `true` or `{ threshold, maxQuarantined, outputFile }` writes `quarantine.json` |
| `context` | extra or overriding Environment rows, see [Environment](#environment) |
| `locale`, `timeZone` | system defaults, for the run timestamp |

`StepRecorder`, `captureFailure` and the renderer share one directory. Set
`TESTREPORTIUM_DIR` once to move all three.

`generateReport(run, options)` does the same as `writeReport` but returns
`{ file, gates, summary, quarantined }`, so your own script can act on the
gate result.

---

## Run history

Every report adds a compact summary of its run (each test's status and
duration, no screenshots) to `testreportium-history.json` next to it and keeps
the last 10. That is what turns a report into a *smart* one:

| Where | What history adds |
|---|---|
| Overview cards | pass-rate and duration change vs the previous run (`↓4%`, `↑11%`) |
| Suite health | grade from pass rate **and** stability (flakiness) **and** performance, not pass rate alone |
| Attention required | **New failures** (passed last run, fail now), **Performance regressions** (≥ 20% and ≥ 100 ms slower than the test's average), **Flaky tests** |
| Sidebar | a **Flaky** tile; **Attention** filters for new failure / regression / flaky / fixed |
| Test detail | pass/fail dots and a duration trend for the last runs, `↑48% slower` / `↓20% faster` |
| **Trends** | pass rate, duration, failed and flaky counts per run, plus a run table |
| **Comparison** | previous run vs this one: new failures, fixed, still failing, new and removed tests, slower and faster tests |

On the first run there is nothing to compare with. Every history-based value
is then shown as absent ("New"), never estimated. A test counts as **flaky**
when its failed share across runs is ≥ 0.3 *and* it has passed at least once.
A test that fails every time is **failing**, not flaky. Re-rendering the same
run replaces its history entry instead of adding a second one.

Keep the output directory between CI runs (cache or artifact) so the history
survives.

## Quality gates and quarantine

Gates are rules you set. The Overview shows each rule with its actual value
and the limit:

```js
qualityGates: {
  maxFailures: 0,          // failed tests allowed
  minPassRate: 95,         // % of executed tests
  maxFlakyRate: 5,         // % of tests
  minStabilityGrade: 'B',  // suite health grade
  noNewFailures: true,     // nothing that passed last run may fail now
}
```

The CLI prints the result, and `--fail-on-gate` exits with 1 when a gate fails.
The Jest adapter prints the result after the run. `noNewFailures` is marked as
not applicable on a first run rather than claimed as passed.

**Quarantine** lists the tests flaky enough to set aside, worst first, with
their flakiness score. The Overview shows the panel whenever there are
candidates. With `quarantine: true` (or `--quarantine`) the list is also
written to `quarantine.json`, so your runner can skip those tests:

```json
{ "threshold": 0.3, "entries": [{ "testId": "orders.spec::Orders TC03 …", "title": "TC03 …", "flakinessScore": 0.43 }] }
```

## Environment

The sidebar's Environment block describes the device and app the run
**actually** used, read from the live Appium session by
`recordSession(driver)`. Nothing is hardcoded. Switch from a Pixel to an
iPhone and the report follows.

| Row | Where it comes from |
|---|---|
| Platform | `platformName` + `platformVersion` → `Android 14`, `iOS 17.4` |
| Device | `deviceManufacturer` + `deviceModel` (Android), else `deviceName` → `Google Pixel 7 Pro` |
| Framework | the app build's own files (below), else the driver (`automationName: Flutter`), else view-hierarchy markers; `+ WebView` when a WEBVIEW context exists |
| App | `appPackage` / `bundleId`, else the `app` file name |
| Automation | `automationName` → `UiAutomator2`, `XCUITest` |
| UDID | `udid` |
| Appium | the server's version from `/status` |

**Framework detection reads evidence, not guesses.** When the `app`
capability points to a local `.apk`, `.ipa` or `.app`, testreportium lists the
files inside it (only the zip index is read, so a 150 MB APK takes about 1 ms)
and looks for what each toolchain always ships:

| Detected | Marker in the build |
|---|---|
| React Native | `index.android.bundle`, `main.jsbundle`, `React.framework`, `hermes.framework` |
| Flutter | `libflutter.so`, `flutter_assets/`, `Flutter.framework` |
| .NET MAUI / Xamarin | `libmonodroid.so`, `assemblies/`, `*.dll` |
| Unity · NativeScript | `libunity.so` / `UnityFramework.framework` · `libNativeScript.so` |
| Capacitor / Cordova | `capacitor.config.json`, `cordova.js` |
| Native (Jetpack Compose) | `META-INF/androidx.compose.*` |
| Native (Android) / (iOS) | `classes.dex` / `Info.plist` with none of the above |

If there is no evidence, for example an app installed by package name only or
a cloud URL like `bs://…`, the row is left out rather than guessed. Fill it
with `context: { Framework: 'React Native' }` or `APPIUM_FRAMEWORK`.

**Precedence, row by row:** the `context` option, then the recorded session,
then the `APPIUM_PLATFORM` / `_FRAMEWORK` / `_DEVICE_NAME` / `_APP_ID` env
vars. Extra `context` keys (`Build: '4.2.0'`) become extra rows. Several devices
in one run are all listed. Sessions recorded before the run started are
ignored, so a leftover file never shows the wrong device.

`captureFailure()` records the session too, so a run that only captures
failures still gets the block. Call `recordSession()` yourself so that
all-green runs get it as well.

## Why this exists

`jest-html-reporters` was evaluated and rejected: it offers no template
override, and its `inlineSource` option inlines JS and CSS but leaves
screenshots as external files, so its 1.5 MB `report.html` still loses its
images the moment it is moved. Verified both ways.

This report is **self-contained by contract**. The design it renders was
originally built on Tailwind + Font Awesome + Google Fonts over CDN; none of
that survived into the code. A report that needs the network renders unstyled
offline, on a locked-down corporate network, and inside many attachment
viewers, which defeats the entire point of attaching it to a ticket. So all
CSS is inline, every icon is an inline SVG, and the fonts are embedded as
base64. The test suite asserts both properties.

## What the report contains

One HTML file laid out like an app.

**Top bar**: the project name, a breadcrumb (`Tests › Overview`, or
`Tests › <test>`), ⌘K search, **Export** (results as JSON or CSV, or print /
save as PDF), a theme picker and the run time.

**Sidebar**: the pass-rate ring, Passed / Failed / Flaky tiles (click to
filter), navigation (Overview, Tests, Trends, Comparison, Gallery), filters
and the Environment block. Filters narrow the **Tests** list: Attention (new
failure, regression, flaky, fixed), Status, Failure kind and Suite group
combine, and "clear all" resets them.

**Overview**
- Suite health (A–F grade from pass rate, stability and performance), pass
  rate and duration with their change vs the last run, and a status breakdown.
- **Quality Gates** and **Quarantine** panels, drawn over a sparkline of
  pass rate and flaky count across runs.
- **Attention required**: new failures, performance regressions, flaky tests.
- **Failure breakdown**: failures split by *whose problem it probably is*:
  possible app defects, locator & wait issues, environment issues (device,
  session, TLS: not a test result at all), hangs & timeouts, and unclassified.
  Click any card to filter the test list.
- **Failure clusters**: failures that share a cause, grouped into one card.
- **Quick insights**: the slowest test, the most flaky test, and the pass-rate trend.
- A per-test duration chart.

**Tests**: a filterable list beside a detail pane. For each test:

| Section | Holds |
|---|---|
| What went wrong | a plain-language diagnosis + the concrete next step |
| Run history | pass/fail dots and duration bars for the last runs of this test |
| Step timeline | a segmented bar (navigation / action / input / wait / failed) and every step with its timing, the slowest marked |
| Full error & stack trace | the raw trace, your frames highlighted |
| Device at failure | the screenshot at the moment of failure (click to enlarge) |

Links like `report.html#t3` open a specific test. `j`/`k` move through the list.

**Trends** and **Comparison**: see [Run history](#run-history).

**Gallery**: every failure screenshot in one grid.

**Themes**: System, Dark, Light, Ocean, Sunset, Dracula, Cyberpunk, Forest, Rose.
Dark is the default: near-black surfaces with neon green, red and yellow for
pass, fail and skip. The choice is remembered per browser.

**Fonts**: Space Grotesk and JetBrains Mono are embedded (latin subset, ~54 KB
before base64, SIL OFL 1.1, licences in `assets/fonts/`). Regenerate with
`npm run fonts` after changing a font file.

### The diagnosis is a classifier, not a guess

Each rule matches a failure shape Appium suites actually produce: `waitForText`
timeout, WebdriverIO `still not displayed after`, element not found, stale
element, `UiAutomation not connected`, trust-anchor/TLS, `ECONNREFUSED`, runner
timeout (Jest, Mocha, WebdriverIO), assertion diff.

**An unrecognised error gets no explanation at all**, rather than a
plausible-sounding wrong one. A confident misdiagnosis costs more than
silence. The raw trace is always one click away, so the explainer never
replaces the evidence.

## Per-step timings

Test runners hand a reporter only a **total** duration per test; there is no
step breakdown to read. So steps are recorded as they happen:
`StepRecorder.step()` times each call and appends one line to `steps.jsonl`,
which the renderer reads back at the end of the run.

```typescript
import { StepRecorder } from 'testreportium';

async tap(el: WebdriverIO.Element, description: string) {
  return StepRecorder.step(`tap ${description}`, async () => { /* … */ });
}
```

Wrap your page-object base class once and every page object produces steps for
free. Call `StepRecorder.setTest(name)` before each test so steps pair with it.
`name` is the describe blocks plus the title, space-joined (what Jest calls
`currentTestName`), or just the test title. The report tries the full name
first, then the title.

Two guarantees hold:

- It **always re-throws.** Swallowing there would hide a real defect.
- A **recording failure is silently ignored.** Instrumentation must never fail
  a test. A reporter that can redden a green run is a source of false
  findings.

## Failure screenshots

`captureFailure(driver, testTitle)` writes the screenshot and page source into
`<outputDirectory>/failures/`, named so the report pairs them with the test.
Both sides use the one `slug()` from `testreportium/slug`, so they cannot drift
apart. In the project this grew out of, two copies did exist, and if they ever diverged every
screenshot would silently vanish from the report.

## Never replaces JUnit XML

This report is purely human-facing and strictly additive. Keep a JUnit
reporter for anything machine-readable: CI gates, dashboards, trend tooling.

---

## Repository layout

```
src/model.js                   the runner-neutral Run / Suite / Test shape
src/render.js                  Run → one self-contained HTML file (zero deps)
src/diagnose.js                failure → plain-language cause, next step, kind
src/history.js                 run history: flakiness, regressions, gates, quarantine
src/fonts.js                   GENERATED: embedded fonts (scripts/embed-fonts.mjs)
src/adapters/junit.js          JUnit XML → Run (any runner)
src/adapters/jest.js           Jest reporter + AggregatedResult → Run
src/cli.js                     the `testreportium` command
src/capture.js                 failure screenshot + page source
src/session.js                 live session → Environment rows, framework detection
src/step-recorder.ts           times each step, writes steps.jsonl
src/slug.js, src/paths.js      the shared naming and directory contracts
assets/fonts/                  the woff2 sources and their OFL licences
docs/reference/                how the Jest adapter is wired in a real project
docs/ROADMAP-report-tiles.txt  unbuilt: clickable KPI tiles, with 27 test cases
test/fixtures/                 a REAL captured run, the golden fixture
```

`test/fixtures/` is a genuine run: `junit.xml`, `steps.jsonl` and failure
artefacts. `expected-report.html` is the golden output rendered from them;
after an intended visual change, regenerate it with `UPDATE_GOLDEN=1 npm test`.

## Publishing

Done: the three hardcoded couplings (output directory, `APPIUM_*` context,
`StepRecorder` path) are options, `dist/` ships compiled JS + `.d.ts`, and the
tests cover the golden file, zero network requests and self-containment.

Left:

- Flip `"private": true` off and `npm publish`.
- Optional: native Mocha / WebdriverIO reporter adapters, so no JUnit step is
  needed.

---

## Known gap

The original design assets (`code.html`, `DESIGN.md`, and the `screen.png`
mockup the dashboard was built to match) were never committed to the original
repository (they were gitignored) and are **missing from disk**. They are not
required to run or modify the renderer, but if a copy turns up, it belongs in
`design/`.

## Licence

MIT
