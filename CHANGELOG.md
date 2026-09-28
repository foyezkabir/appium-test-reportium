# Changelog

Changes are listed under **Unreleased** as they are made, then moved under a
version number when that version is published to npm.

## Unreleased

Will ship as **0.1.1** (already set in `package.json`).

- README: install command at the top, six screenshots (overview, quality gates
  and quarantine, test detail, trends, comparison, light theme) linked from
  GitHub so they show on the npm page.
- README and screenshots: device examples are general (Android / iOS, real or
  emulator) instead of naming one test device.
- Comparison page redesigned: an "Execution telemetry matrix" table (previous
  run vs this run, with a colour-coded change badge per metric) and six
  "Categorized delta inspection" cards: new failures, fixed, still failing,
  new tests, slower, faster. Empty cards say why they are empty.
- Fix: a skipped test is no longer listed as faster (its 0 ms is not a
  speed-up) or slower.
- Sidebar: more space between filter rows. Fix: the sidebar no longer changes
  size when the font loads, a filter is clicked or the view changes (a
  broken style rule had also been disabling the row spacing).
- Quality Gates and Quarantine pills: the status dot pulses (still for
  visitors who prefer reduced motion).
- `npm run demo` builds and opens `demo/report.html` from the current code.
- Trends page redesigned: four chart cards (pass rate, duration, failed tests,
  flaky tests), each with a baseline or peak and a status badge (for example
  "-75 pts Critical", "+414ms Surge"); the current run is highlighted and every
  point or bar has a tooltip. A run table below; past runs expand to show
  that run's failed tests, flaky tests and gate result.
- Fix: the Pass rate and Flaky tests charts rendered as solid black, because
  their styles had been removed along with the old sparklines.

## 0.1.0 · 2026-09-28

First public release.

- Self-contained HTML report: one file, no network calls; fonts, icons and
  failure screenshots embedded.
- Works with any runner through JUnit XML, plus a native Jest reporter and the
  `testreportium` CLI.
- Environment block read from the live Appium session, with the UI framework
  detected from the app build's own files.
- Run history: flaky tests, new failures, performance regressions, Trends and
  a run-to-run Comparison.
- Quality Gates (CLI exits 1 with `--fail-on-gate`) and a Quarantine Registry
  written to `quarantine.json`.
- Plain-language failure diagnosis, step timeline, nine themes, JSON and CSV
  export.
