# Changelog

Changes are listed under **Unreleased** as they are made, then moved under a
version number when that version is published to npm.

## Unreleased

Will ship as **0.2.0** (already set in `package.json`): screen recordings are a new feature.

- New: screen recordings of failed tests. `recordTest(driver)` before a test
  and `finishRecording(driver, title, { keep: failed })` after it; the video is
  kept only for failures and shown beside the screenshot in the test's Device
  at failure section and in the Gallery. Embedded up to `maxVideoSize` (10 MB
  by default); a bigger one is named instead. Android needs nothing extra, iOS
  needs ffmpeg on the Appium host.
- Gallery redesigned: counts for screenshots, recordings and failure captures;
  All / Screenshots / Videos tabs and a sort (failures first, test order,
  failure kind, recordings first); a card for every capture, three per row
  and all the same size, with the screenshot and REC pane side by side. A kept recording of a passed
  test appears too, but only one made during this run. Every card names its
  suite and spec file, since TC numbers repeat across specs, and the sort
  offers By suite.
- Sidebar refresh: the pass ring and the Passed / Failed / Flaky tiles share
  one card, with tiles tinted in their colour (Failed stands out when there
  are failures); new navigation icons, square count badges, and the
  selected page shown like a hovered one, keeping its count; "clear all" sits on the first filter group's line;
  Failure kind and Suite groups are lighter, borderless rows.
- README: install command at the top, then a numbered "Screenshots" section
  (overview, quality gates and quarantine, test detail, trends, comparison,
  light theme), each under its own heading and linked from GitHub so they
  show on the npm page. Repository layout lists every folder and script.
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
- Trend bars are softer: the current run is a fading gradient with a bright
  top edge instead of a solid, glowing block.
- Export → Print / Save as PDF produces a proper PDF: A4, light palette with
  backgrounds kept, each section (Overview, Tests, Trends, Comparison,
  Gallery) on a new page, and no card, chart, table row or test block split
  across a page break. Stack traces print in full and wrap; tables and bar
  charts fit the page; hover-only hints are left out.
- Fix: a skipped test showed "Skipped" twice in its header.
- A colon now separates the TC number from the title (`TC03: Duplicate…`) in
  the test list, the test detail header, the breadcrumb and the PDF.
- Expand arrows (stack trace sections, the run table on Trends) are now a
  28px chevron button in the section's colour instead of a tiny glyph.
- Fix: the current-run label on the Quality Gates and Quarantine charts
  ("13%") sat on top of the trend line; it now sits to the right of the last
  point, where no line can run, in a fixed margin just wide enough for it.
- Fix: the ☰ menu button did nothing on wide screens. It now collapses and
  expands the sidebar (remembered per browser); on narrow screens it still
  slides the sidebar in over the page.
- New icons: a gated shield for Quality Gates (red when a gate fails, green
  when all pass), a hexagonal padlock for the Quarantine Registry, and check
  and cross tiles for each gate rule. They take their colours from the theme.
- New warning icons: a triangle (a dark, glowing version in dark themes and a
  tinted one in light mode and print) on failure clusters, the "Gate failed"
  line and the View failures button, and a squircle warning badge on the
  Failure breakdown heading and on a suite that failed to run.
- README: a full "Reading the report" guide covering the top bar, sidebar,
  every filter (Attention, Failure kind with each matching rule, Suite
  groups, Search) and every view (Overview, Tests, Trends, Comparison,
  Gallery, PDF export), with the exact rule for when a test lands in each.

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
