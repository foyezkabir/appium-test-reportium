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
