/**
 * render.js: the runner-neutral core of testreportium.
 *
 * Takes a `Run` (see model.js) from any adapter and renders one HTML file: a
 * top bar, a sidebar with the pass ring and filters, and three views:
 * Overview (health, attention cards, failure clusters, insights), Tests (a
 * list and a detail pane with the step timeline, diagnosis, trace and the
 * device screenshot at failure), and Gallery.
 *
 * SELF-CONTAINED BY CONTRACT. No CDN, no web fonts over the network, no
 * external images. Fonts are embedded as base64 (SIL OFL), icons are inline
 * SVG, screenshots are data: URIs. A report that needs the network is broken
 * offline, on a locked-down network, and inside attachment viewers, which
 * defeats the point of attaching it to a ticket.
 *
 * NEVER replaces a machine-readable reporter such as JUnit XML. This report is
 * additive and purely human-facing.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { slug } from './slug.js';
import { defaultOutputDirectory } from './paths.js';
import { explain } from './diagnose.js';
import { readSessions } from './session.js';
import { analyzeTests, evaluateGates, historyPath, loadHistory, quarantineList, saveHistory, summarize, testKey, writeQuarantine } from './history.js';
import { SPACE_GROTESK, JETBRAINS_MONO } from './fonts.js';

/** @typedef {import('./model.js').Run} Run */
/** @typedef {import('./model.js').Test} Test */
/** @typedef {import('./model.js').ReportOptions} ReportOptions */

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// eslint-disable-next-line no-control-regex
const stripAnsi = (s = '') => String(s).replace(/\u001b\[[0-9;]*m/g, '');

/** 210ms · 1.86s · 1m 05s */
const dur = (ms) => {
  if (ms == null) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

/** Inline SVG, no icon font, so the report renders with no network. */
const I = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  pass: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/>',
  hourglass: '<path d="M6 2h12M6 22h12M6 2c0 6 6 6 6 10s-6 4-6 10M18 2c0 6-6 6-6 10s6 4 6 10"/>',
  steps: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  folder: '<path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.9a2 2 0 01-1.7-.9l-.9-1.3A2 2 0 007.8 3H4a2 2 0 00-2 2v13a2 2 0 002 2z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  palette: '<circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 22a3 3 0 010-6h2a3 3 0 003-3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  scale: '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 006 0zM18 7l-3 7a3 3 0 006 0z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1117.4 0"/>',
  failTest: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
  skip: '<path d="M5 4l10 8-10 8V4zM19 5v14"/>',
  pie: '<path d="M21.2 15.9A10 10 0 118 2.8"/><path d="M22 12A10 10 0 0012 2v10z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><path d="M7 7h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  apple: '<path d="M16 3c-1.2.1-2.6.9-3.3 2-.7 1-.9 2.2-.8 3.2 1.3.1 2.6-.7 3.3-1.8.7-1 1-2.3.8-3.4zM19.5 16.8c-.6 1.4-1.4 2.8-2.6 3.9-.9.8-2 .8-3 .3-1-.4-1.9-.4-2.9 0-1 .5-2 .6-2.9-.3C5.5 18.1 4 14.6 4.6 11.4c.4-2 2-3.6 4-3.6 1 0 1.9.6 2.8.6s1.9-.7 3.2-.6c1.4.1 2.6.8 3.3 2-2.9 1.7-2.4 5.9.6 7z"/>',
};
const icon = (d, cls = '') =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** Filled glyph: at 13px the stroked outline reads as a padlock. */
const ANDROID = '<svg class="i os" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.52 15.34a1 1 0 110-2 1 1 0 010 2m-11.05 0a1 1 0 110-2 1 1 0 010 2m11.4-6.02l2-3.46a.42.42 0 00-.72-.42l-2.02 3.5A12.3 12.3 0 0012 8.08c-1.85 0-3.59.33-5.14.87l-2.02-3.5a.42.42 0 00-.72.41l2 3.46A11.9 11.9 0 000 18.76h24a11.9 11.9 0 00-6.12-9.44"/></svg>';

/** Colour a stack trace: the message, your frames, and noise. */
function highlight(raw = '') {
  return esc(raw).split('\n').map((l) => {
    if (/^\s*at /.test(l)) {
      if (/node_modules|internal\//.test(l)) return `<span class="dim">${l}</span>`;
      return `<span class="own">${l}</span>`;
    }
    if (/^(Error|.*Error:|expect\()/.test(l.trim())) return `<span class="hl">${l}</span>`;
    return l;
  }).join('\n');
}

/** Steps recorded by StepRecorder during the run, grouped by test name. */
function indexSteps(dir) {
  const idx = new Map();
  const f = join(dir, 'steps.jsonl');
  if (!existsSync(f)) return idx;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!idx.has(r.test)) idx.set(r.test, []);
      idx.get(r.test).push(r);
    } catch { /* a truncated line must not lose the whole file */ }
  }
  return idx;
}

/**
 * Failure artefacts written by captureFailure(), keyed by slugged test title.
 * Names sort by their timestamp prefix, so the latest capture of a test wins.
 */
function indexArtifacts(dir) {
  const idx = new Map();
  const failDir = join(dir, 'failures');
  if (!existsSync(failDir)) return idx;
  for (const f of readdirSync(failDir).sort()) {
    const m = basename(f).match(/^(.+?)__(.+)\.(png|xml)$/);
    if (!m) continue;
    const [, , name, ext] = m;
    const e = idx.get(name) ?? {};
    e[ext] = join(failDir, f);
    idx.set(name, e);
  }
  return idx;
}

const KINDS = {
  app: { label: 'Possible app defects', note: 'The app did not do what the test required', tone: 'red' },
  test: { label: 'Locator & wait issues', note: 'The selector or a wait did not match the screen', tone: 'orange' },
  env: { label: 'Environment issues', note: 'Device, session or network, not a test result', tone: 'yellow' },
  timeout: { label: 'Hangs & timeouts', note: 'Something stalled; see the step timings', tone: 'purple' },
  unknown: { label: 'Unclassified', note: 'No known failure shape matched. Read the trace', tone: 'blue' },
};

/** Step category from its verb, for the timeline colours. */
function stepKind(title = '') {
  const w = title.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (/^(open|navigate|go|goto|launch|back|restart|activate)$/.test(w)) return 'nav';
  if (/^(tap|click|press|swipe|scroll|drag|long|double|hide)/.test(w)) return 'action';
  if (/^(fill|type|enter|set|select|clear|choose|pick)$/.test(w)) return 'input';
  if (/^(wait|expect|assert|verify|check|see|read|get)/.test(w)) return 'check';
  return 'other';
}

const GRADE = (p) => (p >= 90 ? 'A' : p >= 80 ? 'B' : p >= 70 ? 'C' : p >= 60 ? 'D' : 'F');
const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', pending: 'Skipped', todo: 'Todo' };
const statusClass = (s) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'skipped');

/**
 * Pass-ratio donut: passed, failed and skipped as arcs of one ring, in the
 * theme's green, red and yellow. r=40 → circumference 251.33.
 */
function donut(passed, failed, skipped) {
  const total = passed + failed + skipped;
  const C = 2 * Math.PI * 40;
  let at = 0;
  const arcs = [[passed, 'green'], [failed, 'red'], [skipped, 'yellow']].filter(([n]) => n).map(([n, tone]) => {
    const len = (n / total) * C;
    // A 1.5-unit gap between arcs, unless one status is the whole ring.
    const gap = n === total ? 0 : 1.5;
    const arc = `<circle cx="50" cy="50" r="40" class="darc ${tone}" stroke-dasharray="${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
    at += len;
    return arc;
  }).join('');
  return `<svg viewBox="0 0 100 100" class="donut" aria-hidden="true"><circle cx="50" cy="50" r="40" class="dtrack"/>${arcs}</svg>`;
}

/** A ring: r=42 → circumference 263.9. */
function ring(p, tone, label, sub = '') {
  const C = 263.9;
  return `<div class="ring ${tone}"><svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" class="ring-bg"/>
    <circle cx="50" cy="50" r="42" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${(C - (p / 100) * C).toFixed(1)}" transform="rotate(-90 50 50)"/>
  </svg><div class="ring-mid"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
}

function stepTimeline(steps) {
  const total = steps.reduce((a, x) => a + x.ms, 0) || 1;
  const maxMs = Math.max(...steps.map((x) => x.ms), 1);
  const slowest = steps.findIndex((x) => x.ms === maxMs);
  const segs = steps.map((x) => {
    const k = x.status === 'failed' ? 'fail' : stepKind(x.title);
    return `<span class="seg k-${k}" style="flex-grow:${Math.max(x.ms, total * 0.004)}" title="${esc(x.title)}: ${x.ms}ms"></span>`;
  }).join('');
  const kinds = [...new Set(steps.map((x) => (x.status === 'failed' ? 'fail' : stepKind(x.title))))];
  const names = { nav: 'Navigation', action: 'Action', input: 'Input', check: 'Wait / check', other: 'Other', fail: 'Failed' };
  const legend = kinds.map((k) => `<span><i class="seg k-${k}"></i>${names[k]}</span>`).join('');
  const rows = steps.map((x, i) => {
    const cls = [x.status === 'failed' ? 'failed' : '', i === slowest && steps.length > 1 && x.status !== 'failed' ? 'slowest' : ''].join(' ').trim();
    return `<li class="${cls}"><span class="n">${i + 1}</span>
      <span class="st">${esc(x.title)}${x.error ? `<em>${esc(x.error)}</em>` : ''}</span>
      <span class="sbar"><i style="width:${Math.max(2, Math.round((x.ms / maxMs) * 100))}%"></i></span>
      <span class="sms">${dur(x.ms)}</span>${cls.includes('slowest') ? '<span class="tag orange">Slowest</span>' : ''}</li>`;
  }).join('');
  return `<section class="block sec steps"><h4>${icon(I.steps)}Step timeline<span class="cnt">${steps.length}</span><b>${dur(total)}</b></h4>
    <div class="timeline">${segs}</div><div class="legend">${legend}</div><ol>${rows}</ol></section>`;
}

/** Project name for the top bar: option, env, then the nearest package.json. */
function projectName(options) {
  if (options.projectName) return options.projectName;
  if (process.env.TESTREPORTIUM_PROJECT) return process.env.TESTREPORTIUM_PROJECT;
  try {
    const name = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name;
    if (name) return String(name).replace(/^@[^/]+\//, '');
  } catch { /* no package.json, fall through */ }
  return 'Test Report';
}

/**
 * A run-by-run chart with axes: area + line, one hoverable dot per run
 * (tooltip in `tips[i]`), y gridlines, optional dashed threshold, and a
 * callout on the current (last) run. Text is HTML over the SVG so it never
 * stretches with the plot.
 */
function runChart(values, o) {
  const n = values.length;
  if (n < 2) return `<div class="achart empty ${o.tone}"><p>The trend appears from the second run.</p></div>`;
  const top = o.max || 1;
  const X = (i) => 3 + (i / (n - 1)) * 94;
  const Y = (v) => 6 + (1 - Math.max(0, Math.min(v, top)) / top) * 88;
  const pts = values.map((v, i) => [X(i), Y(v)]);
  let line = `M${pts[0][0]},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    if (!o.smooth) { line += `L${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`; continue; }
    // Catmull-Rom → cubic Bézier, clamped so the curve never dips below zero.
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const cy = (y) => Math.min(94, y).toFixed(2);
    line += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${cy(p1[1] + (p2[1] - p0[1]) / 6)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${cy(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  const grid = o.ticks.map((t) => `<div class="gl${o.threshold?.value === t ? ' th' : ''}" style="top:${Y(t).toFixed(2)}%"><span>${esc(o.fmt(t))}</span></div>`).join('');
  const th = o.threshold ? `<div class="thr" style="top:${Y(o.threshold.value).toFixed(2)}%"></div>` : '';
  const dots = pts.map(([x, y], i) => {
    const side = i < Math.min(2, n / 2) ? ' tl' : i >= n - 2 ? ' tr' : '';
    return `<button type="button" class="spt${i === n - 1 ? ' cur' : ''}${side}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-tip="${esc(o.tips[i] ?? '')}" aria-label="${esc((o.tips[i] ?? '').replace(/\n/g, ', '))}"></button>`;
  }).join('');
  const [lx, ly] = pts[n - 1];
  const callout = `<span class="callout" style="left:${lx.toFixed(2)}%;top:${ly.toFixed(2)}%">${esc(o.fmt(values[n - 1]))}</span>`;
  const xl = o.xLabels.map(([l, sub], i) => `<span class="${i === n - 1 ? 'cur' : ''}" style="left:${X(i).toFixed(2)}%">${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`).join('');
  return `<div class="achart ${o.tone}"><div class="aplot">${grid}${th}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${line}L${pts[n - 1][0]},100L${pts[0][0]},100Z" class="afill"/><path d="${line}" class="aline" vector-effect="non-scaling-stroke"/></svg>
    ${dots}${callout}</div><div class="axl">${xl}</div></div>`;
}

/**
 * Trend card charts: one point or bar per run, oldest → newest, the value
 * under each, the current run highlighted, and a hover tooltip per run.
 */
function trendArea(values, { tone, fmt, tips, alertLast = false }) {
  const n = values.length;
  const max = Math.max(...values, 1) * 1.12;
  const X = (i) => (n === 1 ? 50 : 4 + (i / (n - 1)) * 92);
  const Y = (v) => 8 + (1 - v / max) * 84;
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const path = (from, to) => pts.slice(from, to + 1).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  const all = path(0, n - 1);
  // A sharp fall into the current run is drawn in red so it cannot be missed.
  const tail = alertLast && n > 1 ? `<path d="${path(n - 2, n - 1)}" class="tline alert" vector-effect="non-scaling-stroke"/>` : '';
  const dots = pts.map(([x, y], i) => `<button type="button" class="spt${i === n - 1 ? ' cur' : ''}${i === n - 1 && alertLast ? ' alert' : ''}${i < 2 ? ' tl' : i >= n - 2 ? ' tr' : ''}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-tip="${esc(tips[i] ?? '')}" aria-label="${esc((tips[i] ?? '').replace(/\n/g, ', '))}"></button>`).join('');
  return `<div class="tplot ${tone}"><div class="tarea">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="tg-${tone}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="gs1"/><stop offset="1" class="gs2"/></linearGradient></defs>
      <path d="${all}L${pts[n - 1][0]},100L${pts[0][0]},100Z" fill="url(#tg-${tone})"/><path d="${all}" class="tline" vector-effect="non-scaling-stroke"/>${tail}</svg>${dots}</div>
    ${tlabels(values, fmt, X, true, alertLast)}</div>`;
}

function trendBars(values, { tone, fmt, tips }) {
  const n = values.length;
  const max = Math.max(...values, 1);
  const X = (i) => ((i + 0.5) / n) * 100;
  const bars = values.map((v, i) => `<div class="tbarcol" style="left:${X(i).toFixed(2)}%"><span class="tbar2${i === n - 1 ? ' cur' : ''}${i < 2 ? ' tl' : i >= n - 2 ? ' tr' : ''}" style="height:${Math.max(3, Math.round((v / max) * 88))}%" data-tip="${esc(tips[i] ?? '')}" tabindex="0"></span></div>`).join('');
  return `<div class="tplot ${tone}"><div class="tarea">${bars}</div>${tlabels(values, fmt, X, true)}</div>`;
}

function tlabels(values, fmt, X, boxLast, alert = false) {
  return `<div class="tlab">${values.map((v, i) => `<span class="${i === values.length - 1 && boxLast ? `cur${alert ? ' alert' : ''}` : ''}" style="left:${X(i).toFixed(2)}%">${esc(fmt(v))}</span>`).join('')}</div>`;
}

/**
 * Everything the page needs, computed once. Pure apart from reading
 * steps.jsonl, failure artefacts, sessions.jsonl and the history file.
 *
 * @param {Run} run
 * @param {ReportOptions} options
 */
function prepare(run, options) {
  const dir = options.outputDirectory ?? defaultOutputDirectory();
  const artifacts = indexArtifacts(dir);
  const stepIdx = indexSteps(dir);
  const histFile = historyPath(dir, options);
  // Earlier runs only: a re-render of the same run must not compare with itself.
  const past = (options.historyRuns ?? loadHistory(histFile)).filter((r) => r.startTime !== run.startTime && r.startTime < run.startTime);

  const tests = run.suites.flatMap((s) => s.tests.map((t) => ({ ...t, file: s.file })));
  tests.forEach((t, i) => {
    t.id = `t${i + 1}`;
    t.key = testKey(t.file, t.fullName);
    t.st = statusClass(t.status);
    t.groupName = (t.group ?? []).join(' › ') || t.file;
    t.tc = (t.title.match(/^(TC[-_]?\d+)/i) || [])[1] ?? '';
    t.rest = t.tc ? t.title.slice(t.tc.length).replace(/^[:\s-]+/, '') : t.title;
    t.steps = stepIdx.get(t.fullName) ?? stepIdx.get(t.title) ?? [];
    t.diag = t.st === 'failed' ? (t.errors ?? []).map((m) => explain(m)).find(Boolean) ?? null : null;
    t.kind = t.st === 'failed' ? (t.diag?.kind ?? 'unknown') : null;
    t.firstLine = stripAnsi((t.errors ?? [])[0] ?? '').split('\n').find((l) => l.trim())?.trim() ?? '';
    const art = t.st === 'failed' ? artifacts.get(slug(t.title)) : undefined;
    if (art?.png) {
      try { t.png = readFileSync(art.png).toString('base64'); } catch { /* unreadable artefact must not break the report */ }
    }
  });
  const insight = analyzeTests(tests, past, options);
  for (const t of tests) {
    t.ins = insight.get(t.key);
    t.att = [t.ins.newFailure && 'new', t.ins.health === 'flaky' && 'flaky', t.ins.slower && 'slow', t.ins.fixed && 'fixed'].filter(Boolean);
  }

  const total = tests.length;
  const passed = tests.filter((t) => t.st === 'passed').length;
  const failed = tests.filter((t) => t.st === 'failed').length;
  const skipped = total - passed - failed;
  const executed = passed + failed;
  const passRate = pct(passed, executed);
  const duration = run.duration ?? Date.now() - run.startTime;
  const hasHistory = past.length > 0;
  const flaky = tests.filter((t) => t.ins.health === 'flaky');
  const newFailures = tests.filter((t) => t.ins.newFailure);
  const slower = tests.filter((t) => t.ins.slower);
  const fixed = tests.filter((t) => t.ins.fixed);
  const scored = tests.filter((t) => t.ins.flakiness !== undefined);
  const stability = scored.length ? Math.round(100 - (scored.reduce((a, t) => a + t.ins.flakiness, 0) / scored.length) * 100) : undefined;
  const timed = tests.filter((t) => t.ins.change !== undefined);
  const perf = timed.length ? Math.round(100 - pct(slower.length, timed.length)) : undefined;
  // Health: pass rate alone on a first run; with history, stability and speed count too.
  const health = hasHistory && stability !== undefined
    ? Math.round(passRate * 0.4 + stability * 0.35 + (perf ?? 100) * 0.25)
    : passRate;
  const grade = GRADE(health);
  const flakyRate = pct(flaky.length, total);

  const prev = past[past.length - 1];
  const prevRate = prev ? pct(prev.passed, prev.passed + prev.failed) : undefined;
  const summary = { startTime: run.startTime, duration, total, passed, failed, skipped, flaky: flaky.length, passRate, grade, health };
  const gates = evaluateGates(options.qualityGates, { failed, passRate, flakyRate, grade, newFailures: newFailures.length, hasHistory });
  const qCfg = typeof options.quarantine === 'object' ? options.quarantine : {};
  const qThreshold = qCfg.threshold ?? options.flakyThreshold ?? 0.3;
  const quarantined = quarantineList(tests, insight, qThreshold).slice(0, qCfg.maxQuarantined ?? Infinity);

  return {
    dir, histFile, past, prev, prevRate, tests, total, passed, failed, skipped, executed, passRate, duration,
    hasHistory, flaky, newFailures, slower, fixed, stability, perf, health, grade, flakyRate, summary, gates,
    quarantined, qThreshold, crashed: run.suites.filter((s) => !s.tests.length && s.error), run,
  };
}

/** "↑11%" / "↓4%" badge; `good` says which direction is an improvement. */
function delta(now, before, { good = 'up', unit = '%', relative = false } = {}) {
  if (before === undefined || before === null || now === undefined) return '';
  const d = relative ? (before ? Math.round(((now - before) / before) * 100) : 0) : Math.round(now - before);
  if (!d) return '<span class="delta flat">±0' + unit + '</span>';
  const better = good === 'up' ? d > 0 : d < 0;
  return `<span class="delta ${better ? 'good' : 'bad'}">${d > 0 ? '↑' : '↓'}${Math.abs(d)}${unit}</span>`;
}

const HEALTH = {
  new: ['New', 'blue'], stable: ['Stable', 'green'], unstable: ['Unstable', 'yellow'],
  flaky: ['Flaky', 'orange'], failing: ['Failing', 'red'], skipped: ['Skipped', 'yellow'],
};
const ATT = { new: ['New failure', 'red'], flaky: ['Flaky', 'orange'], slow: ['Regression', 'purple'], fixed: ['Fixed', 'green'] };

/**
 * Render a run as one self-contained HTML document.
 *
 * @param {Run} run
 * @param {ReportOptions} [options]
 * @returns {string}
 */
export function renderReport(run, options = {}) {
  return page(prepare(run, options), options);
}

function page(c, options) {
  const { tests, total, passed, failed, skipped, executed, passRate, duration, past, prev, hasHistory } = c;
  const run = c.run;
  const workers = run.workers;
  const shots = tests.filter((t) => t.png);
  const context = environment(c.dir, run.startTime, options.context);
  const ctxEntries = Object.entries(context).filter(([, v]) => v);
  const project = projectName(options);
  const title = options.pageTitle ?? `${project} · Test Report`;
  const started = new Date(run.startTime).toLocaleString(options.locale, { timeZone: options.timeZone });
  const allGreen = failed === 0 && c.crashed.length === 0;
  const series = [...past, c.summary]; // oldest → newest, this run last
  const rateOf = (r) => pct(r.passed, r.passed + r.failed);

  // ── overview ──────────────────────────────────────────────────────────
  const byKind = new Map();
  for (const t of tests.filter((x) => x.kind)) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);

  const attCards = [
    [c.newFailures.length, 'New failures', 'Tests that were passing, now failing', 'red', 'att:new'],
    [c.slower.length, 'Performance regressions', 'Tests that got slower than their average', 'purple', 'att:slow'],
    [c.flaky.length, 'Flaky tests', 'Tests with unstable results across runs', 'yellow', 'att:flaky'],
  ].filter(([n]) => n).map(([n, l, note, tone, go]) => `<button class="att ${tone}" data-go="${go}"><b>${n}</b><span>${l}</span><small>${note}</small></button>`).join('');
  const kindCards = [...byKind.entries()].map(([k, list]) => `<button class="att ${KINDS[k].tone}" data-go="kind:${k}">
      <b>${list.length}</b><span>${esc(KINDS[k].label)}</span><small>${esc(KINDS[k].note)}</small></button>`).join('');

  const clusters = new Map();
  for (const t of tests.filter((x) => x.st === 'failed')) {
    const key = t.diag?.why ?? t.firstLine.replace(/\d+/g, '#');
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(t);
  }
  const clusterHtml = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => `
    <article class="cluster ${KINDS[list[0].kind].tone}">
      <header>${icon(I.alert)}<b>${esc(key)}</b><span class="count">${list.length} test${list.length > 1 ? 's' : ''}</span></header>
      <pre>${esc(list[0].firstLine)}</pre>
      <div class="chips">${list.map((t) => `<a class="chip" href="#${t.id}">${esc(t.tc || t.rest.slice(0, 28))}</a>`).join('')}</div>
      <small>${esc(KINDS[list[0].kind].label)} · ${esc([...new Set(list.map((t) => t.groupName))].join(', '))}</small>
    </article>`).join('');

  // Recompute each earlier run's facts from the history, exactly as this run's
  // were computed, so a tooltip says what that run's report said.
  const curTests = Object.fromEntries(tests.map((t) => [t.key, [t.st, t.duration ?? null]]));
  const full = [...past, { ...c.summary, tests: curTests }];
  const nameOf = (k) => k.split('::').slice(1).join('::');
  const facts = full.map((r, i) => {
    const earlier = full.slice(0, i);
    const keys = Object.keys(r.tests);
    const ins = analyzeTests(keys.map((k) => ({ key: k, st: r.tests[k][0], duration: r.tests[k][1] })), earlier, options);
    const flakyKeys = keys.filter((k) => ins.get(k).health === 'flaky');
    const newFail = keys.filter((k) => ins.get(k).newFailure);
    const executedN = r.passed + r.failed;
    const g = i === full.length - 1 ? c.gates : evaluateGates(options.qualityGates, {
      failed: r.failed, passRate: pct(r.passed, executedN), flakyRate: pct(flakyKeys.length, keys.length),
      grade: undefined, newFailures: newFail.length, hasHistory: i > 0,
    });
    return { r, flakyKeys, newFail, g, rate: pct(r.passed, executedN), total: keys.length };
  });
  const when = (r, i) => `${new Date(r.startTime).toLocaleString(options.locale, { timeZone: options.timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${i === full.length - 1 ? '  ·  this run' : ''}`;
  const pts = (d) => (d > 0 ? `▲ ${d} pts` : d < 0 ? `▼ ${-d} pts` : 'no change');
  const names = (keys) => keys.length ? keys.slice(0, 3).map(nameOf).join('\n') + (keys.length > 3 ? `\n+${keys.length - 3} more` : '') : '';
  const gateTips = facts.map((f, i) => [
    when(f.r, i),
    `Pass rate ${f.rate}%${i ? `  (${pts(f.rate - facts[i - 1].rate)} vs previous)` : ''}`,
    `${f.r.passed} passed · ${f.r.failed} failed · ${f.r.skipped} skipped`,
    f.g ? `Gates: ${f.g.passed ? 'PASSED' : `FAILED: ${f.g.rules.filter((x) => !x.passed).map((x) => x.label).join(', ')}`}` : '',
    f.newFail.length ? `New failures: ${f.newFail.length}` : '',
  ].filter(Boolean).join('\n'));
  const flakyTips = facts.map((f, i) => [
    when(f.r, i),
    `${f.flakyKeys.length} flaky of ${f.total} tests (${pct(f.flakyKeys.length, f.total)}%)${i ? `  ·  ${f.flakyKeys.length - facts[i - 1].flakyKeys.length >= 0 ? '+' : ''}${f.flakyKeys.length - facts[i - 1].flakyKeys.length} vs previous` : ''}`,
    names(f.flakyKeys),
  ].filter(Boolean).join('\n'));
  const nRuns = full.length;
  const xLabels = (cur, sub) => full.map((_, i) => (i === nRuns - 1 ? [cur, sub] : [`Run -${nRuns - 1 - i}`, i === 0 ? 'Oldest' : '']));
  const qg = options.qualityGates ?? {};
  const RULE_DESC = {
    'Max failures': () => `Condition: ≤ ${qg.maxFailures} failures allowed`,
    'Min pass rate': () => `Target: ≥ ${qg.minPassRate}% of executed tests pass`,
    'Max flaky rate': () => `Limit: ≤ ${qg.maxFlakyRate}% of tests flaky`,
    'Min stability grade': () => `Target: suite grade ${qg.minStabilityGrade} or better`,
    'No new failures': () => 'Nothing that passed last run may fail now',
  };
  const panelHead = (ic, title, sub, right) => `<header class="qhead"><span class="qicon">${icon(ic)}</span>
      <div class="qtitle"><b>${title}</b><small>${esc(sub)}</small></div><div class="qright">${right}</div></header>`;

  let gatesHtml = '';
  if (c.gates) {
    const rules = c.gates.rules;
    const bad = rules.filter((x) => !x.passed).length;
    const card = (x) => {
      const st = x.skipped ? 'skip' : x.passed ? 'ok' : 'no';
      const m = String(x.actual).match(/^(\d+%?|[A-F])(.*)$/);
      const big = m ? m[1] : x.actual;
      const rest = m ? m[2] : '';
      return `<div class="rule ${st}"><span class="rmark">${x.skipped ? '–' : x.passed ? '✓' : '✕'}</span>
        <div class="rtext"><b>${esc(x.label)}</b><small>${esc(RULE_DESC[x.label]?.() ?? '')}</small></div>
        <div class="rval"><span><b>${esc(big)}</b>${esc(rest)}${x.limit ? ` <i>${esc(x.limit)}</i>` : ''}</span><em>${x.skipped ? 'N/A' : x.passed ? 'Passed' : 'Failed'}</em></div></div>`;
    };
    const rates = facts.map((f) => f.rate);
    const d = nRuns > 1 ? rates[nRuns - 1] - rates[nRuns - 2] : 0;
    gatesHtml = `<article class="qpanel ${c.gates.passed ? 'green' : 'red'}">
    ${panelHead(I.shield, 'Quality Gates', 'Rules this run is checked against', `<span class="qrun">Run #${nRuns}</span><span class="qbadge"><i></i>Gate ${c.gates.passed ? 'passed' : 'failed'}</span>`)}
    <div class="qbody">
      <section class="qlist"><div class="qlh"><small>Gate evaluation policy</small><span>${bad ? `${bad} / ${rules.length} rules violated` : `${rules.length} / ${rules.length} rules met`}</span></div>
        ${rules.map(card).join('')}
        <p class="qfoot">${icon(bad ? I.alert : I.pass)}${bad ? `Gate failed: ${bad} of ${rules.length} rule${rules.length === 1 ? '' : 's'} unmet.` : `All ${rules.length} rules met.`}</p></section>
      <section class="qchart"><div class="qch"><div><h4>Pass rate trend (last ${nRuns} run${nRuns === 1 ? '' : 's'})</h4><p>Pass rate of each run, oldest → current</p></div>
        <div class="qlegend"><span><i class="ln"></i>Pass rate (%)</span>${qg.minPassRate !== undefined ? `<span><i class="dash"></i>Min threshold (${qg.minPassRate}%)</span>` : ''}</div></div>
        ${runChart(rates, { max: 100, ticks: [20, 40, 60, 80, 100].concat(qg.minPassRate !== undefined && ![20, 40, 60, 80, 100].includes(qg.minPassRate) ? [qg.minPassRate] : []), fmt: (v) => `${v}%`, tone: c.gates.passed ? 'green' : 'red', tips: gateTips, threshold: qg.minPassRate !== undefined ? { value: qg.minPassRate } : null, xLabels: xLabels(`Run #${nRuns}`, 'Current') })}
        <div class="qcf"><span>${icon(I.bulb)}Hover any point to inspect that run.</span>${nRuns > 1 ? `<span class="${d < 0 ? 'bad' : d > 0 ? 'good' : ''}">Δ ${d > 0 ? '+' : ''}${d} pts vs previous run</span>` : ''}</div></section>
    </div></article>`;
  }

  let quarantineHtml = '';
  if (c.quarantined.length) {
    const enabled = Boolean(options.quarantine);
    const counts = facts.map((f) => f.flakyKeys.length);
    const top = Math.max(...counts, 1) + 1;
    const qcard = (q) => {
      const t = tests.find((x) => x.key === q.key);
      const runs = [...t.ins.past.map((p) => p.s), t.st].filter((x) => x !== 'skipped');
      const fails = runs.filter((x) => x === 'failed').length;
      return `<a class="qitem" href="#${t.id}"><div class="qmain"><b>${t.tc ? `<span class="tctag">${esc(t.tc)}</span>` : ''}${esc(t.rest)}</b>
        <small>Suite: ${esc(t.groupName)} · Failed in ${fails}/${runs.length} runs${t.kind ? ` · ${esc(KINDS[t.kind].label)}` : ''}</small></div>
        <div class="qscore"><b>${q.score.toFixed(2)}</b><em>${enabled ? 'Quarantined' : 'Candidate'}</em></div></a>`;
    };
    quarantineHtml = `<article class="qpanel yellow">
    ${panelHead(I.lock, 'Quarantine Registry', enabled ? 'Flaky tests set aside, written to quarantine.json' : 'Tests flaky enough to set aside', `<span class="qrun">Policy threshold ≥ ${c.qThreshold.toFixed(2)} flakiness</span><span class="qbadge"><i></i>${c.quarantined.length} test${c.quarantined.length === 1 ? '' : 's'} ${enabled ? 'quarantined' : 'flagged'}</span>`)}
    <div class="qbody">
      <section class="qlist"><div class="qlh"><small>Isolated test candidates</small><span>Score · Status</span></div>
        ${c.quarantined.map(qcard).join('')}
        <p class="qfoot">${icon(I.info)}${enabled ? 'Listed in quarantine.json so your runner can skip them.' : 'Turn on quarantine (quarantine: true or --quarantine) to write quarantine.json.'}</p></section>
      <section class="qchart"><div class="qch"><div><h4>Flaky test volume (last ${nRuns} run${nRuns === 1 ? '' : 's'})</h4><p>Number of flaky tests at each run</p></div>
        <span class="qtarget">Target: 0 flaky</span></div>
        ${runChart(counts, { max: top, ticks: Array.from({ length: top + 1 }, (_, i) => i), fmt: String, tone: 'yellow', smooth: true, tips: flakyTips, xLabels: xLabels('Current', `${counts[nRuns - 1]} flaky`) })}
        <div class="qcf"><span>${icon(I.bulb)}Hover any point to see which tests were flaky.</span></div></section>
    </div></article>`;
  }

  const slowest = [...tests].filter((t) => t.duration != null).sort((a, b) => b.duration - a.duration)[0];
  const mostFlaky = [...tests].filter((t) => t.ins.flakiness !== undefined && t.ins.health !== 'failing').sort((a, b) => b.ins.flakiness - a.ins.flakiness)[0];
  const allSteps = tests.flatMap((t) => t.steps.map((s) => ({ ...s, t })));
  const slowStep = allSteps.sort((a, b) => b.ms - a.ms)[0];
  const groups = [...new Set(tests.map((t) => t.groupName))];
  const insight = (ic, label, main, sub, href) => `<a class="insight" ${href ? `href="#${href}"` : ''}>
      <span class="ico">${icon(ic)}</span><span><small>${esc(label)}</small><b>${esc(main)}</b><em>${esc(sub)}</em></span></a>`;
  const trendStrip = hasHistory ? `<a class="insight" href="#trends"><span class="ico">${icon(I.trend)}</span><span><small>Pass rate trend</small>
      <span class="strip">${series.map((r) => { const v = rateOf(r); return `<i class="${v >= 90 ? 'green' : v >= 70 ? 'yellow' : 'red'}" style="height:${Math.max(8, v)}%" title="${v}%"></i>`; }).join('')}</span></span></a>` : '';

  const maxDur = Math.max(...tests.map((t) => t.duration ?? 0), 1);
  const bars = tests.slice(0, 40).map((t) => `<a class="bar-col" href="#${t.id}" title="${esc(t.title)}: ${dur(t.duration)}">
      <span class="bar-val">${dur(t.duration)}</span>
      <span class="bar-wrap"><i class="bar ${t.st}" style="height:${Math.max(2, Math.round(((t.duration ?? 0) / maxDur) * 100))}%"></i></span>
      <span class="bar-lbl">${esc((t.tc || t.rest).slice(0, 8))}</span></a>`).join('');

  const healthTone = c.health >= 90 ? 'green' : c.health >= 70 ? 'blue' : c.health >= 60 ? 'yellow' : 'red';
  const overview = `<section class="view" id="v-overview" data-view="overview">
  <h2 class="vtitle">Overview</h2>
  <div class="cards">
    <article class="card health">${ring(c.health, healthTone, c.grade, String(c.health))}
      <div><small class="lbl">Suite health</small><p>Pass: ${passRate}%</p><p>Stability: ${c.stability ?? 'n/a'}${c.stability !== undefined ? '%' : ''}</p><p>Perf: ${c.perf ?? 'n/a'}${c.perf !== undefined ? '%' : ''}</p></div></article>
    <article class="card"><div class="bigrow"><b class="big">${passRate}%</b>${delta(passRate, c.prevRate)}</div><small class="lbl">Pass rate</small><p>${passed}/${executed} tests</p></article>
    <article class="card"><div class="bigrow"><b class="big">${dur(duration)}</b>${delta(duration, prev?.duration, { good: 'down', relative: true })}</div><small class="lbl">Duration</small><p>${workers ? `${workers} worker${workers > 1 ? 's' : ''}` : 'Total run time'}</p></article>
    <article class="card mix">
      ${[['Passed', passed, 'green'], ['Failed', failed, 'red'], ['Skipped', skipped, 'mut']].map(([l, n, cl]) =>
        `<div><span>${l}</span><span class="track"><i class="${cl}" style="width:${pct(n, total)}%"></i></span><b>${n}</b></div>`).join('')}
    </article>
  </div>
  ${c.crashed.map((s) => `<article class="cluster red crash"><header>${icon(I.alert)}<b>Suite failed to run: ${esc(s.file)}</b></header>
    <pre class="err">${esc(stripAnsi(s.error))}</pre></article>`).join('')}
  ${gatesHtml}${quarantineHtml}
  ${attCards ? `<h3 class="shead">${icon(I.bolt)}Attention required</h3><div class="atts">${attCards}</div>` : ''}
  ${kindCards ? `<h3 class="shead">${icon(I.alert)}Failure breakdown</h3><div class="atts">${kindCards}</div>` : ''}
  ${clusterHtml ? `<h3 class="shead">${icon(I.search)}Failure clusters</h3><div class="clusters">${clusterHtml}</div>` : ''}
  <h3 class="shead">${icon(I.bulb)}Quick insights</h3>
  <div class="insights">
    ${slowest ? insight(I.hourglass, 'Slowest test', slowest.title, dur(slowest.duration), slowest.id) : ''}
    ${mostFlaky && mostFlaky.ins.flakiness > 0 ? insight(I.bolt, 'Most flaky test', mostFlaky.title, `${Math.round(mostFlaky.ins.flakiness * 100)}% failure rate`, mostFlaky.id)
      : slowStep ? insight(I.steps, 'Slowest step', slowStep.title, `${dur(slowStep.ms)} · ${slowStep.t.tc || slowStep.t.rest}`, slowStep.t.id) : ''}
    ${trendStrip}
  </div>
  <div class="panels">
    <section class="panel"><h3 class="ptitle">${icon(I.chart)}Test duration profile</h3>
      <p class="psub">Per-test execution time${tests.length > 40 ? ' (first 40 shown)' : ''}</p>
      <div class="chart"><div class="bars">${bars || '<p class="empty">No tests ran.</p>'}</div></div></section>
    <section class="panel"><h3 class="ptitle">${icon(I.pass)}Pass ratio</h3>
      <p class="psub">Across every spec in this run</p>
      <div class="donut-wrap">${donut(passed, failed, skipped)}
        <div class="donut-mid"><b>${passed} / ${total}</b><span>passed</span><small>${failed} fail · ${skipped} skip</small></div></div>
      <div class="dlegend">
        <div><span><i class="green"></i>Pass rate</span><b>${passRate}%</b></div>
        <div><span><i class="blue"></i>Total duration</span><b>${dur(duration)}</b></div>
        <div><span><i class="purple"></i>Suites</span><b>${run.suites.length}</b></div>
      </div></section>
  </div>
</section>`;

  // ── tests: list + detail ──────────────────────────────────────────────
  const attTags = (t) => t.att.map((a) => `<span class="tag ${ATT[a][1]}">${ATT[a][0]}</span>`).join('');
  const listHtml = groups.map((g) => {
    const l = tests.filter((t) => t.groupName === g);
    const nf = l.filter((t) => t.st === 'failed').length;
    return `<div class="lgroup"><div class="lghead">${icon(I.folder)}<span>${esc(g)}</span>${nf ? `<span class="tag red">${nf} failing</span>` : `<span class="tag green">${l.length}</span>`}</div>
      ${l.map((t) => `<a class="titem ${t.st}" href="#${t.id}" data-id="${t.id}" data-st="${t.st}" data-kind="${t.kind ?? ''}" data-group="${esc(g)}" data-att="${t.att.join(' ')}">
        <span class="dot"></span><span class="tt"><b>${t.tc ? `<em>${esc(t.tc)}</em> ` : ''}${esc(t.rest)}</b><small>${esc(t.kind ? KINDS[t.kind].label : t.steps.length ? `${t.steps.length} steps` : STATUS_LABEL[t.status] ?? t.status)}</small>${t.att.length ? `<span class="ttags">${attTags(t)}</span>` : ''}</span>
        <span class="td">${dur(t.duration)}</span></a>`).join('')}</div>`;
  }).join('');

  const historyBlock = (t) => {
    const runs = [...t.ins.past, { s: t.st, d: t.duration ?? null, startTime: run.startTime, cur: true }].slice(-10);
    if (runs.length < 2) return '';
    const exec = runs.filter((r) => r.s !== 'skipped');
    const rate = pct(exec.filter((r) => r.s === 'passed').length, exec.length);
    const ds = runs.map((r) => r.d ?? 0);
    const dmax = Math.max(...ds, 1);
    return `<section class="block hist"><h4>${icon(I.chart)}Run history <span class="muted">(last ${runs.length} runs)</span></h4>
      <div class="hgrid"><div><small class="lbl">Pass / fail</small><div class="hdots">${runs.map((r) => `<i class="${r.s}${r.cur ? ' cur' : ''}" title="${esc(new Date(r.startTime).toLocaleString())}: ${r.s}"></i>`).join('')}</div><p class="muted mono">Pass rate: ${rate}%</p></div>
      <div><small class="lbl">Duration trend</small><div class="hbars">${runs.map((r) => `<i class="${r.cur ? 'cur' : ''}" style="height:${Math.max(6, Math.round(((r.d ?? 0) / dmax) * 100))}%" title="${dur(r.d)}"></i>`).join('')}</div>
      <p class="muted mono">Avg: ${dur(t.ins.avg)} · Current: ${dur(t.duration)}</p></div></div></section>`;
  };

  const details = tests.map((t) => {
    const errs = t.errors ?? [];
    const [hl, ht] = HEALTH[t.ins.health];
    const speed = t.ins.change !== undefined && Math.abs(t.ins.change) >= 0.05
      ? `<span class="speed ${t.ins.change > 0 ? 'bad' : 'good'}">${icon(I.clock)}${t.ins.change > 0 ? '↑' : '↓'}${Math.round(Math.abs(t.ins.change) * 100)}% ${t.ins.change > 0 ? 'slower' : 'faster'}</span>` : '';
    return `<article class="detail ${t.st}" id="d-${t.id}" data-id="${t.id}">
      <header class="dhead"><span class="dot"></span><div class="dtitle"><h3>${t.tc ? `<em>${esc(t.tc)}</em> ` : ''}${esc(t.rest)}</h3>
        <div class="dmeta"><span class="chip mono">${esc(t.file)}</span>${t.groupName !== t.file ? `<span class="chip">${esc(t.groupName)}</span>` : ''}${attTags(t)}</div></div>
        <div class="dstat"><span class="mono">${dur(t.duration)}</span>${t.att.includes('flaky') || t.ins.health === 'skipped' ? '' : `<span class="tag ${ht}">${hl}</span>`}${t.kind ? `<span class="tag ${KINDS[t.kind].tone}">${esc(KINDS[t.kind].label)}</span>` : ''}<span class="pill ${t.st}">${esc(STATUS_LABEL[t.status] ?? t.status)}</span>${speed}</div></header>
      ${t.diag ? `<section class="block sec why"><h4>${icon(I.info)}What went wrong</h4><p>${esc(t.diag.why)}</p><p class="next">${esc(t.diag.next)}</p></section>` : ''}
      ${historyBlock(t)}
      ${t.steps.length ? stepTimeline(t.steps) : ''}
      ${errs.map((m) => `<details class="block sec raw"${t.diag ? '' : ' open'}><summary>${icon(I.code)}Full error &amp; stack trace</summary><pre class="err">${highlight(stripAnsi(m))}</pre></details>`).join('')}
      ${t.png ? `<section class="block sec media"><h4>${icon(I.device)}Device at failure</h4><figure class="shot"><img alt="device at failure: ${esc(t.title)}" src="data:image/png;base64,${t.png}"><figcaption>${((t.png.length * 3) / 4 / 1024).toFixed(0)} KB<span class="noprint"> · click to enlarge</span></figcaption></figure></section>` : ''}
      ${!errs.length && !t.steps.length ? `<p class="empty">${t.st === 'passed' ? 'Passed. No steps were recorded for this test.' : 'Not run.'}</p>` : ''}
    </article>`;
  }).join('');

  const testsView = `<section class="view" id="v-tests" data-view="tests">
  <h2 class="vtitle print-only">Tests <span class="muted mono">${total} test${total === 1 ? '' : 's'}</span></h2>
  <div class="split">
    <aside class="tlist"><div class="tlist-top"><input id="tf" class="input" type="search" placeholder="Filter tests…" autocomplete="off"><span id="tcount" class="mono muted"></span></div>
      <div class="tlist-body">${listHtml || '<p class="empty">No tests ran.</p>'}</div></aside>
    <div class="tdetail">${details}<p class="empty pick">Select a test.</p></div>
  </div>
</section>`;

  // ── trends ────────────────────────────────────────────────────────────
  const noHistory = (what) => `<div class="panel empty-state">${icon(I.trend)}<b>${what} appear from the second run</b>
    <p>Each report saves a summary of its run to <code>${esc(basename(c.histFile ?? 'testreportium-history.json'))}</code> next to the report. Run the suite again and this view fills in.</p></div>`;
  const fmtRun = (r) => new Date(r.startTime).toLocaleString(options.locale, { timeZone: options.timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  let trendsView;
  if (hasHistory) {
    const rates = facts.map((f) => f.rate);
    const durs = full.map((r) => r.duration);
    const fails = full.map((r) => r.failed);
    const flakies = facts.map((f) => f.flakyKeys.length);
    const L = nRuns - 1;
    const dRate = rates[L] - rates[L - 1];
    const dDur = durs[L] - durs[L - 1];
    const dFail = fails[L] - fails[L - 1];
    const dFlaky = flakies[L] - flakies[L - 1];
    const sev = (d) => (d <= -20 ? ['Critical', 'red'] : d < 0 ? ['Drop', 'orange'] : d > 0 ? ['Improved', 'green'] : ['Stable', 'mut']);
    const [rateWord, rateTone] = sev(dRate);
    const rel = durs[L - 1] ? dDur / durs[L - 1] : 0;
    const durBadge = rel > 0.1 ? [`+${dur(dDur)} Surge`, 'red'] : rel < -0.1 ? [`−${dur(-dDur)} Faster`, 'green'] : [`${dDur >= 0 ? '+' : '−'}${dur(Math.abs(dDur))} Steady`, 'mut'];
    const flakyBadge = dFlaky > 0 ? [`Rising flakiness (${flakies[L]})`, 'red'] : dFlaky < 0 ? [`Falling flakiness (${flakies[L]})`, 'green'] : [`Stable flakiness (${flakies[L]})`, 'yellow'];
    const failedNames = (r) => Object.entries(r.tests).filter(([, v]) => v[0] === 'failed').map(([k]) => nameOf(k));
    const durTips = full.map((r, i) => [when(r, i), `Duration ${dur(r.duration)}${i ? `  (${durs[i] - durs[i - 1] >= 0 ? '+' : '−'}${dur(Math.abs(durs[i] - durs[i - 1]))} vs previous)` : ''}`, `${r.passed + r.failed + r.skipped} tests`].join('\n'));
    const failTips = full.map((r, i) => { const nm = failedNames(r); return [when(r, i), `${r.failed} failed of ${r.passed + r.failed + r.skipped}${i ? `  (${fails[i] - fails[i - 1] >= 0 ? '+' : ''}${fails[i] - fails[i - 1]} vs previous)` : ''}`, nm.slice(0, 3).join('\n') + (nm.length > 3 ? `\n+${nm.length - 3} more` : '')].filter(Boolean).join('\n'); });
    const card = (dotTone, title, ctx, [badgeText, badgeTone], chart) => `<article class="tcard">
      <header><span class="tdot ${dotTone}"></span><h4>${title}</h4><span class="tctx">${ctx}</span><span class="tbadge ${badgeTone}">${esc(badgeText)}</span></header>${chart}</article>`;
    const specs = [...new Set(run.suites.map((x) => x.file))];

    const tableRows = [...full].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
      const isCur = i === L;
      const rate = rates[i];
      const nm = failedNames(r);
      const fk = facts[i].flakyKeys.map(nameOf);
      const trendArrow = i > 0 ? (rate < rates[i - 1] ? ' ↘' : rate > rates[i - 1] ? ' ↗' : '') : '';
      const details = `<tr class="rdetail" id="rd-${i}" hidden><td colspan="9"><div class="rdgrid">
        <div><small>Failed (${nm.length})</small>${nm.length ? nm.map((x) => `<span>${esc(x)}</span>`).join('') : '<em>None</em>'}</div>
        <div><small>Flaky at this run (${fk.length})</small>${fk.length ? fk.map((x) => `<span>${esc(x)}</span>`).join('') : '<em>None</em>'}</div>
        <div><small>Gate</small>${facts[i].g ? `<span class="${facts[i].g.passed ? 'g' : 'r'}">${facts[i].g.passed ? 'Passed' : `Failed: ${esc(facts[i].g.rules.filter((x) => !x.passed).map((x) => x.label).join(', '))}`}</span>` : '<em>No gates configured</em>'}</div>
      </div></td></tr>`;
      return `<tr class="${isCur ? 'cur' : ''}">
        <td><span class="rts">${esc(fmtRun(r))}</span>${isCur ? `<span class="thisrun">This run</span><span class="runno">#${i + 1}</span>` : `<span class="runno">#${i + 1}</span>`}</td>
        <td>${r.passed + r.failed + r.skipped}</td><td class="g">${r.passed}</td><td class="${r.failed ? 'r' : ''}">${r.failed}</td><td>${r.skipped}</td>
        <td class="${fk.length ? 'y' : ''}">${fk.length}</td><td class="rate ${rate >= 80 ? '' : rate >= 60 ? 'y' : 'r'}">${rate}%${trendArrow}</td><td class="${isCur ? 'b' : ''}">${dur(r.duration)}</td>
        <td>${isCur ? '<a class="ract" href="#overview">Report</a>' : `<button type="button" class="rexp" data-rd="rd-${i}" aria-expanded="false" aria-label="Show run #${i + 1} details">›</button>`}</td></tr>${details}`;
    }).join('');

    trendsView = `<section class="view" id="v-trends" data-view="trends">
  <div class="thead2"><div><h2>Trends <span class="runs">${nRuns} runs</span></h2><p>Run history for the ${esc(project)} suite</p></div>
    <div class="tactions"><a class="tbtn" href="#comparison">${icon(I.scale)}Compare runs</a><span class="tbtn static">${icon(I.clock)}Last ${nRuns} runs</span>
    ${failed ? `<a class="tbtn danger" href="#tests" data-go="st:failed">${icon(I.alert)}View failures</a>` : ''}</div></div>
  <div class="tgrid">
    ${card('blue', 'Pass rate', `Baseline: ${rates[L - 1]}%`, [`${dRate > 0 ? '+' : ''}${dRate} pts ${rateWord}`, rateTone], trendArea(rates, { tone: 'blue', fmt: (v) => `${v}%`, tips: gateTips, alertLast: dRate <= -20 }))}
    ${card('blue', 'Duration', `Peak: ${dur(Math.max(...durs))}`, durBadge, trendBars(durs, { tone: 'blue', fmt: dur, tips: durTips }))}
    ${card('red', 'Failed tests', `Total run specs: ${total}`, [`${failed} Failed (${dFail >= 0 ? '+' : ''}${dFail})`, dFail > 0 ? 'red' : dFail < 0 ? 'green' : 'mut'], trendBars(fails, { tone: 'red', fmt: String, tips: failTips }))}
    ${card('yellow', 'Flaky tests', `Peak: ${Math.max(...flakies)}`, flakyBadge, trendArea(flakies, { tone: 'yellow', fmt: String, tips: flakyTips }))}
  </div>
  <article class="rmatrix"><header>${icon(I.grid)}<b>Historical runs execution matrix</b><span class="muted">Showing last ${nRuns} executions</span>
    <span class="spect">Spec target: ${esc(specs.join(', ').slice(0, 60))}</span></header>
    <div class="tablewrap"><table class="htable"><thead><tr><th>Run timestamp</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Flaky</th><th>Pass rate</th><th>Duration</th><th>Action</th></tr></thead>
    <tbody>${tableRows}</tbody></table></div></article>
</section>`;
  } else {
    trendsView = `<section class="view" id="v-trends" data-view="trends"><h2 class="vtitle">Trends</h2>${noHistory('Trends')}</section>`;
  }

  // ── comparison with the previous run ──────────────────────────────────
  let comparisonView;
  if (prev) {
    const cur = new Map(tests.map((t) => [t.key, t]));
    const was = (k) => prev.tests[k]?.[0];
    const prevMs = (t) => prev.tests[t.key]?.[1];
    const stillFailing = tests.filter((t) => t.st === 'failed' && was(t.key) === 'failed');
    const added = tests.filter((t) => !prev.tests[t.key]);
    const removed = Object.keys(prev.tests).filter((k) => !cur.has(k));
    // A skipped test's 0 ms is not a speed-up: only compare tests that ran both times.
    const moved = tests.filter((t) => prevMs(t) && t.duration != null && t.st !== 'skipped' && was(t.key) !== 'skipped')
      .map((t) => ({ t, d: t.duration - prevMs(t) }))
      .filter((x) => Math.abs(x.d) >= 100);
    const slowerNow = moved.filter((x) => x.d > 0).sort((p1, p2) => p2.d - p1.d);
    const fasterNow = moved.filter((x) => x.d < 0).sort((p1, p2) => p1.d - p2.d);
    const prevRun = nRuns - 1;

    // ── the metric table ──
    const badge = (now, before, { good = 'up', unit = '', relative = false, strong = false } = {}) => {
      const d = relative ? (before ? Math.round(((now - before) / before) * 100) : 0) : Math.round(now - before);
      if (!d) return { html: `<span class="dbadge flat">±0${unit}</span>`, bad: false };
      const bad = good === 'up' ? d < 0 : d > 0;
      return { html: `<span class="dbadge ${bad ? 'bad' : 'good'}${strong && bad ? ' strong' : ''}">${d > 0 ? '↑' : '↓'}${Math.abs(d)}${unit}</span>`, bad };
    };
    const rateTone = (v) => (v >= 80 ? 'g' : v >= 60 ? 'y' : 'r');
    const rows = [
      { ic: I.folder, label: 'Tests', a: prev.passed + prev.failed + prev.skipped, b: total, tone: '', o: {} },
      { ic: I.pass, label: 'Passed', a: prev.passed, b: passed, tone: 'g', ict: 'green', o: { good: 'up' } },
      { ic: I.failTest, label: 'Failed', a: prev.failed, b: failed, tone: 'r', ict: 'red', o: { good: 'down', strong: true }, tint: true },
      { ic: I.skip, label: 'Skipped', a: prev.skipped, b: skipped, tone: '', o: { good: 'down' } },
      { ic: I.bolt, label: 'Flaky', a: prev.flaky ?? 0, b: c.flaky.length, tone: 'y', ict: 'yellow', o: { good: 'down' }, tint: true },
      { ic: I.pie, label: 'Pass rate', a: c.prevRate, b: passRate, fmt: (v) => `${v}%`, toneOf: rateTone, ict: 'blue', o: { good: 'up', unit: '%' }, tint: true },
      { ic: I.clock, label: 'Duration', a: prev.duration, b: duration, fmt: dur, tone: '', o: { good: 'down', unit: '%', relative: true } },
    ];
    const matrix = rows.map((r) => {
      const d = badge(r.b, r.a, r.o);
      const f = r.fmt ?? String;
      const ta = r.toneOf ? r.toneOf(r.a) : (r.a ? r.tone : '');
      const tb = r.toneOf ? r.toneOf(r.b) : (r.b ? r.tone : '');
      return `<tr class="${r.tint && d.bad ? 'worse' : ''}"><td><span class="mlabel">${icon(r.ic, r.ict ?? '')}${r.label}</span></td>
        <td class="${ta}">${esc(f(r.a))}</td><td class="now ${tb}">${esc(f(r.b))}</td><td>${d.html}</td></tr>`;
    }).join('');

    // ── the delta cards ──
    const tcOf = (t) => (t.tc ? `<b class="tcid">${esc(t.tc)}:</b> ${esc(t.rest)}` : esc(t.title));
    const box = (t, sub, right = '') => `<a class="ditem" href="#${t.id}"><span class="dtitle">${tcOf(t)}</span>
      <span class="dsub"><span>${esc(sub)}</span>${right ? `<em>${esc(right)}</em>` : ''}</span></a>`;
    const line = (t) => `<a class="dline" href="#${t.id}">${tcOf(t)}</a>`;
    const msChange = (t) => { const pm = prevMs(t); if (!pm || t.duration == null) return ''; const d = t.duration - pm; return Math.abs(d) >= 1 ? `${d > 0 ? '+' : '−'}${dur(Math.abs(d))}` : ''; };
    const MAX = 6;
    const more = (n) => (n > MAX ? `<p class="dmore">+ ${n - MAX} more</p>` : '');
    const empty = (ic, sub) => `<div class="dempty">${ic ? `<span class="dicon">${icon(ic)}</span>` : ''}<b>None</b><small>${esc(sub)}</small></div>`;
    const card = (title, tone, n, body, emptyIc, emptySub) => `<article class="dcard ${tone}">
      <header><h4>${title}</h4><span class="dcount">${n}</span></header>
      <div class="dbody">${n ? body : empty(emptyIc, emptySub)}</div></article>`;
    const kindOf = (t) => (t.kind ? KINDS[t.kind].label : 'Failed now');
    const cards = [
      card('New failures', 'red', c.newFailures.length,
        c.newFailures.slice(0, MAX).map((t, i) => (i === 0 ? box(t, kindOf(t), msChange(t)) : line(t))).join('') + more(c.newFailures.length),
        I.pass, 'Nothing that passed last run fails now'),
      card('Fixed', 'green', c.fixed.length,
        c.fixed.slice(0, MAX).map((t) => box(t, 'Failed last run, passes now', msChange(t))).join('') + more(c.fixed.length),
        I.pass, 'No test that failed last run passes now'),
      card('Still failing', 'orange', stillFailing.length,
        stillFailing.slice(0, MAX).map((t) => box(t, `Failed in the previous run too · ${kindOf(t)}`)).join('') + more(stillFailing.length),
        I.pass, 'No test failed in both runs'),
      card('New tests', 'blue', added.length,
        added.slice(0, MAX).map((t) => box(t, `Not in run #${prevRun} · ${STATUS_LABEL[t.status] ?? t.status}`)).join('') + more(added.length),
        I.plus, 'Same tests as the previous run'),
      card('Slower', 'purple', slowerNow.length,
        slowerNow.slice(0, MAX).map((x) => box(x.t, `${dur(prevMs(x.t))} → ${dur(x.t.duration)}`, `+${dur(x.d)}`)).join('') + more(slowerNow.length),
        null, 'No test got slower by 100 ms or more'),
      card('Faster', 'teal', fasterNow.length,
        fasterNow.slice(0, MAX).map((x) => box(x.t, `${dur(prevMs(x.t))} → ${dur(x.t.duration)}`, `−${dur(-x.d)}`)).join('') + more(fasterNow.length),
        null, 'No test got faster by 100 ms or more'),
    ].join('');
    const removedCard = removed.length ? card('Removed tests', 'mut', removed.length,
      removed.slice(0, MAX).map((k) => `<span class="dline">${esc(k.split('::').slice(1).join('::'))}</span>`).join('') + more(removed.length), null, '') : '';

    comparisonView = `<section class="view" id="v-comparison" data-view="comparison">
  <h2 class="vtitle">Comparison <span class="muted mono">Run #${prevRun} (${esc(fmtRun(prev))}) → Run #${nRuns}</span></h2>
  <article class="matrix"><header>${icon(I.grid)}<b>Execution telemetry matrix</b><span>Showing ${rows.length} compared metrics</span></header>
    <div class="tablewrap"><table class="mtable"><thead><tr><th>Metric</th><th>Previous (Run #${prevRun})</th><th>This run (Run #${nRuns})</th><th>Change / delta</th></tr></thead>
    <tbody>${matrix}</tbody></table></div></article>
  <div class="dhead2">${icon(I.tag)}<b>Categorized delta inspection</b><span>Run #${prevRun} → Run #${nRuns}</span></div>
  <div class="dgrid">${cards}${removedCard}</div>
</section>`;
  } else {
    comparisonView = `<section class="view" id="v-comparison" data-view="comparison"><h2 class="vtitle">Comparison</h2>${noHistory('Comparisons')}</section>`;
  }

  const galleryView = `<section class="view" id="v-gallery" data-view="gallery">
  <h2 class="vtitle">Gallery <span class="muted mono">${shots.length} screenshot${shots.length === 1 ? '' : 's'}</span></h2>
  ${shots.length ? `<div class="gallery">${shots.map((t) => `<a class="gitem" href="#${t.id}"><img alt="" data-from="${t.id}"><span><b>${esc(t.tc || t.rest)}</b><small>${esc(t.diag?.why ?? t.firstLine)}</small></span></a>`).join('')}</div>`
    : '<p class="empty">No failure screenshots in this run.</p>'}
</section>`;

  // ── sidebar ───────────────────────────────────────────────────────────
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const rowChip = (f, v, label, n, lead, tone = '') => `<button class="frow ${tone}" data-f="${f}" data-v="${esc(v)}" title="${esc(label)}">
      ${lead}<span class="fname">${esc(label)}</span><i>${n}</i></button>`;
  const osIcon = (v = '') => /android/i.test(v) ? ANDROID
    : /ios|iphone|ipad/i.test(v) ? icon(I.apple, 'os') : '';
  const envRow = ([k, v]) => {
    const cls = k === 'App' ? 'val green' : k === 'Framework' ? 'val blue' : 'val';
    return `<div class="erow"><span>${esc(k)}</span><b class="${cls}" title="${esc(v)}">${k === 'Platform' ? osIcon(v) : ''}${esc(v)}</b></div>`;
  };
  const attn = [['new', c.newFailures.length], ['slow', c.slower.length], ['flaky', c.flaky.length], ['fixed', c.fixed.length]].filter(([, n]) => n);
  const tile = (n, label, tone, f, v) => `<button class="tile ${tone}" data-f="${f}" data-v="${v}"${n ? '' : ' disabled'}><b>${n}</b><small>${label}</small></button>`;
  const sidebar = `<aside class="side" id="side">
    <div class="side-scroll">
    <div class="side-ring">${ring(passRate, allGreen ? 'green' : passRate >= 70 ? 'yellow' : 'red', `${passRate}%`)}<small class="lbl">Pass rate</small></div>
    <div class="tiles">${tile(passed, 'Passed', 'green', 'st', 'passed')}${tile(failed, 'Failed', 'red', 'st', 'failed')}${tile(c.flaky.length, 'Flaky', 'yellow', 'att', 'flaky')}</div>
    <nav class="nav"><small class="lbl">Navigation</small>
      <a href="#overview" data-nav="overview">${icon(I.chart)}<span>Overview</span><em class="navdot"></em></a>
      <a href="#tests" data-nav="tests">${icon(I.list)}<span>Tests</span><i>${total}</i><em class="navdot"></em></a>
      <a href="#trends" data-nav="trends">${icon(I.trend)}<span>Trends</span>${hasHistory ? `<i>${series.length}</i>` : ''}<em class="navdot"></em></a>
      <a href="#comparison" data-nav="comparison">${icon(I.scale)}<span>Comparison</span><em class="navdot"></em></a>
      <a href="#gallery" data-nav="gallery">${icon(I.image)}<span>Gallery</span><i>${shots.length}</i><em class="navdot"></em></a>
    </nav>
    <div class="filters">
      <div class="fhead"><small class="lbl">Filters</small><button id="fclear" class="linkbtn" disabled>clear all</button></div>
      ${attn.length ? `<div class="fgroup"><div class="fsub"><small>Attention</small><span>vs earlier runs</span></div>
        <div class="frows">${attn.map(([a, n]) => rowChip('att', a, ATT[a][0], n, '<span class="sdot"></span>', ATT[a][1])).join('')}</div></div>` : ''}
      ${byKind.size ? `<div class="fgroup"><div class="fsub"><small>Failure kind</small><span>${plural(byKind.size, 'category', 'categories')}</span></div>
        <div class="frows">${[...byKind.entries()].map(([k, l]) => rowChip('kind', k, KINDS[k].label, l.length, '<span class="sdot"></span>', KINDS[k].tone)).join('')}</div></div>` : ''}
      ${groups.length > 1 ? `<div class="fgroup"><div class="fsub"><small>Suite groups</small><span>${plural(groups.length, 'group', 'groups')}</span></div>
        <div class="frows">${groups.map((g) => rowChip('group', g, g, tests.filter((t) => t.groupName === g).length, icon(I.folder, 'fic'), 'group')).join('')}</div></div>` : ''}
    </div>
    <div class="env"><div class="ehead"><small class="lbl">${icon(I.chip)}Environment</small><span class="edot${ctxEntries.length ? '' : ' off'}" title="${ctxEntries.length ? 'Read from the live session' : 'No session recorded'}"></span></div>
      ${ctxEntries.length ? ctxEntries.map(envRow).join('') : `<p class="enone">No device or app recorded for this run. Call <code>recordSession(driver)</code> after the session starts, or pass <code>context</code>.</p>`}</div>
    </div>
  </aside>`;

  // Data for Export: no screenshots, just the results. '<' is escaped so a
  // test name can never close the script tag.
  const data = JSON.stringify({
    project, generatedBy: 'testreportium', summary: c.summary, environment: context, gates: c.gates,
    tests: tests.map((t) => ({
      id: t.key, title: t.title, group: t.groupName, file: t.file, status: t.status, duration: t.duration ?? null,
      error: t.firstLine || null, diagnosis: t.diag?.why ?? null, kind: t.kind, health: t.ins.health,
      flakiness: t.ins.flakiness ?? null, newFailure: t.ins.newFailure, fixed: t.ins.fixed, slower: t.ins.slower,
    })),
  }).replace(/</g, '\\u003c');

  const THEMES = ['system', 'dark', 'light', 'ocean', 'sunset', 'dracula', 'cyberpunk', 'forest', 'rose'];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<script>try{var t=localStorage.getItem('testreportium-theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>${css()}</style></head><body>
<header class="top">
  <button class="iconbtn" id="menu" aria-label="Toggle sidebar">${icon(I.menu)}</button>
  <div class="brand"><b>${esc(project)}</b></div>
  <nav class="crumb" aria-label="Breadcrumb"><a href="#overview">Tests</a><span class="sep">›</span><span id="crumb">Overview</span></nav>
  <label class="search">${icon(I.search)}<input id="q" type="search" placeholder="Search…" autocomplete="off"><kbd>⌘K</kbd></label>
  <div class="export"><button class="topbtn" id="exp" aria-haspopup="true" aria-expanded="false">${icon(I.download)}<span>Export</span></button>
    <div class="menu" id="expmenu" hidden><button data-exp="json">Results (JSON)</button><button data-exp="csv">Results (CSV)</button><button data-exp="print">Print / Save as PDF</button></div></div>
  <label class="themesel topbtn">${icon(I.monitor)}<select id="theme" aria-label="Theme">${THEMES.map((t) => `<option value="${t}">${t[0].toUpperCase()}${t.slice(1)}</option>`).join('')}</select></label>
  <span class="stamp" title="${allGreen ? 'All green' : `${failed} failing`}"><span class="dot ${allGreen ? 'passed' : 'failed'}"></span>${esc(started)}</span>
</header>
<div class="shell">
${sidebar}
<main class="main">
${overview}
${testsView}
${trendsView}
${comparisonView}
${galleryView}
</main></div>
<div class="lightbox" id="lb" hidden><button class="iconbtn" aria-label="Close">${icon(I.x)}</button><img alt=""></div>
<footer class="foot">Generated by testreportium · self-contained, fonts and screenshots embedded, no network needed</footer>
<script type="application/json" id="trdata">${data}</script>
<script>${clientJs()}</script>
</body></html>`;
}

/**
 * The Environment block. Most specific wins, row by row:
 *   options.context  >  the live session (sessions.jsonl)  >  APPIUM_* env vars
 * A row with no value from any source is left out, never guessed.
 */
function environment(dir, runStart, given = {}) {
  const env = {
    Platform: process.env.APPIUM_PLATFORM, Framework: process.env.APPIUM_FRAMEWORK,
    Device: process.env.APPIUM_DEVICE_NAME, App: process.env.APPIUM_APP_ID,
  };
  const merged = { ...env, ...readSessions(dir, runStart), ...given };
  const order = ['Platform', 'Device', 'Framework', 'App', 'Automation', 'UDID', 'Appium'];
  const keys = [...order.filter((k) => k in merged), ...Object.keys(merged).filter((k) => !order.includes(k))];
  return Object.fromEntries(keys.map((k) => [k, merged[k]]).filter(([, v]) => v));
}

/**
 * Render and write the report, then add this run to the history and, when
 * enabled, write the quarantine file. Reporting never throws for history:
 * a history that cannot be saved costs trends, not the report.
 *
 * @param {Run} run
 * @param {ReportOptions} [options]
 * @returns {{ file: string, gates: ReturnType<typeof evaluateGates>, summary: object, quarantined: Array<{ title: string, score: number }> }}
 */
export function generateReport(run, options = {}) {
  const c = prepare(run, options);
  mkdirSync(c.dir, { recursive: true });
  const file = join(c.dir, options.filename ?? 'report.html');
  writeFileSync(file, page(c, options));
  try {
    saveHistory(c.histFile, loadHistory(c.histFile), summarize(run, c.flaky.length), options.maxHistoryRuns ?? 10);
    if (options.quarantine) {
      const qFile = (typeof options.quarantine === 'object' && options.quarantine.outputFile) || join(c.dir, 'quarantine.json');
      writeQuarantine(qFile, c.quarantined, c.qThreshold);
    }
  } catch (e) {
    console.warn(`[testreportium] history not saved: ${e.message}`);
  }
  return { file, gates: c.gates, summary: c.summary, quarantined: c.quarantined.map((t) => ({ title: t.title, score: t.score })) };
}

/**
 * Render and write the report into `outputDirectory`. Returns the file path.
 *
 * @param {Run} run
 * @param {ReportOptions} [options]
 * @returns {string}
 */
export function writeReport(run, options = {}) {
  return generateReport(run, options).file;
}

// ── palette ─────────────────────────────────────────────────────────────
// One token set per theme; every colour in the CSS goes through these, so a
// new theme is a single line here.
const T = (bg, bg2, card, hover, side, border, glow, fg, fg2, mut, g, gd, r, rd, y, yd, b, bd, p, o) =>
  `--bg:${bg};--bg2:${bg2};--card:${card};--hover:${hover};--side:${side};--border:${border};--glow:${glow};` +
  `--fg:${fg};--fg2:${fg2};--mut:${mut};--green:${g};--green-d:${gd};--red:${r};--red-d:${rd};` +
  `--yellow:${y};--yellow-d:${yd};--blue:${b};--blue-d:${bd};--purple:${p};--orange:${o}`;
const DARK = T('#0a0a0f', '#12121a', '#1a1a24', '#22222e', '#0d0d14', '#2a2a3a', '#3b3b4f', '#f0f0f5', '#8888a0', '#5a5a70', '#00ff88', '#00cc6a', '#ff4466', '#cc3355', '#ffcc00', '#ccaa00', '#00aaff', '#0088cc', '#aa66ff', '#ff8844');
const LIGHT = T('#f5f5f7', '#ffffff', '#ffffff', '#f0f0f2', '#fafafa', '#e0e0e5', '#d0d0d8', '#1a1a1f', '#5a5a6e', '#8a8a9a', '#00aa55', '#008844', '#dd3344', '#bb2233', '#cc9900', '#aa7700', '#0077cc', '#005599', '#8844cc', '#dd6622');
const THEMES = {
  ocean: T('#0b1628', '#0f1f38', '#152847', '#1a3358', '#091320', '#1e3a5f', '#2a4f7a', '#d4e5f7', '#7ba3c9', '#4a7a9f', '#00d4aa', '#00a886', '#ff6b8a', '#d44a6a', '#ffd166', '#ccaa44', '#00b4d8', '#0090ad', '#8ea4f2', '#ff9e6d'),
  sunset: T('#1a0f0a', '#241510', '#2e1c14', '#3a241a', '#140c08', '#4a3028', '#5f3e32', '#f5e6dc', '#c9a08a', '#8a6a55', '#7ecf8a', '#5aad66', '#ff6b6b', '#d44a4a', '#ffc857', '#cca040', '#6eb5ff', '#4a90d4', '#c084fc', '#ff8c42'),
  dracula: T('#282a36', '#21222c', '#343746', '#3e4155', '#1e1f29', '#44475a', '#555870', '#f8f8f2', '#bfbfb0', '#6272a4', '#50fa7b', '#3ad462', '#ff5555', '#d43d3d', '#f1fa8c', '#c9d46e', '#8be9fd', '#62c4d8', '#bd93f9', '#ffb86c'),
  cyberpunk: T('#0a0014', '#110022', '#1a0033', '#220044', '#08000f', '#2d0055', '#4400aa', '#e0d0ff', '#a080cc', '#6644aa', '#00ff9f', '#00cc7f', '#ff0055', '#cc0044', '#ffee00', '#ccbb00', '#00ccff', '#00aadd', '#cc00ff', '#ff6600'),
  forest: T('#0c1a0e', '#112416', '#182e1c', '#1e3a22', '#091408', '#254a2a', '#305a36', '#d4ecd8', '#88b890', '#557a5c', '#4ade80', '#38b866', '#f87171', '#cc5555', '#fbbf24', '#cc9a1a', '#67c9e0', '#48a6bc', '#a78bfa', '#fb923c'),
  rose: T('#1a0a14', '#24101c', '#2e1626', '#3a1c30', '#140810', '#4a2840', '#5f3452', '#f5dce8', '#c990af', '#8a5a74', '#6ee7b7', '#4fbc94', '#fb7185', '#d45468', '#fcd34d', '#ccaa3a', '#93c5fd', '#6da0d8', '#e879f9', '#fdba74'),
};

function css() {
  return `
@font-face{font-family:"Space Grotesk";font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${SPACE_GROTESK}) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${JETBRAINS_MONO}) format("woff2")}
:root{${DARK};color-scheme:dark;--sans:"Space Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--side-w:320px;--top-h:56px}
@media(prefers-color-scheme:light){:root:not([data-theme]){${LIGHT};color-scheme:light}}
:root[data-theme="dark"]{${DARK};color-scheme:dark}
:root[data-theme="light"]{${LIGHT};color-scheme:light}
${Object.entries(THEMES).map(([k, v]) => `:root[data-theme="${k}"]{${v};color-scheme:dark}`).join('\n')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg)}
/* Reserve scrollbar space so switching between a long and a short view never shifts the layout. */
html{scrollbar-gutter:stable}
body{font-family:var(--sans);font-size:14px;line-height:1.5;min-height:100vh}
a{color:inherit;text-decoration:none}
button,select,input{font:inherit;color:inherit}
.i{width:16px;height:16px;flex:none}
.mono{font-family:var(--mono)}.muted{color:var(--mut)}
.lbl{display:block;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2)}
.empty{color:var(--mut);padding:28px;text-align:center}
[hidden]{display:none!important}
/* ── top bar ── */
.top{position:sticky;top:0;z-index:20;height:var(--top-h);display:flex;align-items:center;gap:14px;padding:0 16px;
background:var(--bg2);border-bottom:1px solid var(--border);box-shadow:inset 0 -2px 0 -1px var(--orange)}
.top::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,var(--orange),var(--red) 40%,transparent)}
.iconbtn{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:var(--card);cursor:pointer}
.iconbtn:hover{border-color:var(--glow);background:var(--hover)}
.brand{display:flex;align-items:center;min-width:0;padding-left:4px}
.brand b{font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}
.brand small{font-family:var(--mono);font-size:11px;color:var(--fg2)}
.crumb{display:flex;align-items:center;gap:8px;padding-left:16px;border-left:1px solid var(--border);white-space:nowrap;min-width:0}
.crumb a{font-weight:600}.crumb a:hover{color:var(--blue)}.crumb .sep{color:var(--mut)}
#crumb{color:var(--fg2);overflow:hidden;text-overflow:ellipsis;max-width:40vw}
.search{margin-left:auto;display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg2);width:260px}
.search:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
.search input{flex:1;min-width:0;border:0;background:transparent;outline:none;color:var(--fg)}
kbd{font-family:var(--mono);font-size:10px;border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--mut)}
.topbtn,.themesel{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg);cursor:pointer;font-size:13px;font-weight:500}
.topbtn:hover,.themesel:hover{border-color:var(--glow);background:var(--hover)}
.export{position:relative}
.menu{position:absolute;right:0;top:42px;z-index:40;min-width:200px;display:grid;padding:6px;border:1px solid var(--border);border-radius:10px;background:var(--card);box-shadow:0 16px 40px -12px rgba(0,0,0,.6)}
.menu button{border:0;background:none;text-align:left;padding:9px 12px;border-radius:7px;cursor:pointer;font-size:13px}
.menu button:hover{background:var(--hover)}
.themesel select{border:0;background:transparent;outline:none;cursor:pointer;color:var(--fg)}
.themesel option{background:var(--card);color:var(--fg)}
.stamp{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--fg2);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--mut)}
.dot.passed,.passed>.dot,.passed .dhead>.dot{background:var(--green);box-shadow:0 0 8px var(--green)}
.dot.failed,.failed>.dot,.failed .dhead>.dot{background:var(--red);box-shadow:0 0 8px var(--red)}
.skipped>.dot,.skipped .dhead>.dot{background:var(--yellow)}
/* ── shell ── */
.shell{display:grid;grid-template-columns:var(--side-w) minmax(0,1fr);min-height:calc(100vh - var(--top-h))}
.side{background:var(--side);border-right:1px solid var(--border);position:sticky;top:var(--top-h);height:calc(100vh - var(--top-h));display:flex;flex-direction:column;min-height:0}
.side-scroll{flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable;padding:0 12px 20px 16px}
.side .lbl{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg2)}
.side-ring{display:grid;justify-items:center;gap:8px;padding:20px 0 16px;border-bottom:1px solid var(--border)}
.side-ring .ring{width:88px;height:88px}
/* navigation */
.nav{padding:18px 0;border-bottom:1px solid var(--border);display:grid;gap:4px}
.nav .lbl{padding:0 2px 8px}
.nav a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;border-left:2px solid transparent;color:var(--fg2);font-weight:500;font-size:13.5px}
.nav a .i{color:var(--mut)}
.nav a:hover{background:var(--hover);color:var(--fg)}
.nav a span{flex:1}
.nav a i{font-style:normal;font-family:var(--mono);font-size:11px;padding:1px 8px;border-radius:999px;background:var(--hover);color:var(--fg2)}
.nav a .navdot{display:none;width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}
.nav a.on{background:color-mix(in srgb,var(--green) 10%,transparent);border-left-color:var(--green);color:var(--fg)}
.nav a.on .i{color:var(--green)}
.nav a.on i{display:none}.nav a.on .navdot{display:block}
/* filters */
.filters{padding:18px 0 4px;display:grid;grid-template-columns:minmax(0,1fr);gap:24px}
.fgroup{min-width:0}
.fhead{display:flex;align-items:center;justify-content:space-between}
.linkbtn{border:0;background:none;color:var(--blue);cursor:pointer;font-family:var(--mono);font-size:11px}
.linkbtn:hover:not(:disabled){text-decoration:underline}
.linkbtn:disabled{color:var(--mut);cursor:default;opacity:.6}
.fsub{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.fsub small{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2)}
.fsub span{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.sdot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--tone,var(--mut))}
/* minmax(0,1fr): a long group name must truncate, never widen the column. */
.frows{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.frow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border);
background:var(--card);color:var(--fg2);font-size:13px;text-align:left;cursor:pointer;min-width:0}
.frow:hover{border-color:color-mix(in srgb,var(--tone,var(--blue)) 50%,transparent);color:var(--fg);background:var(--hover)}
.frow .fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frow i{font-style:normal;font-family:var(--mono);font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:6px;border:1px solid var(--border);background:var(--hover);color:var(--fg2);flex:none}
/* Selected rows change colour only, never weight: bolder text is wider and would reflow the row. */
.frow.on{border-color:var(--tone,var(--blue));background:color-mix(in srgb,var(--tone,var(--blue)) 10%,var(--card));color:var(--fg)}
.frow.on .sdot{box-shadow:0 0 0 3px color-mix(in srgb,var(--tone) 30%,transparent)}
.frow.on i{color:var(--tone,var(--blue));border-color:color-mix(in srgb,var(--tone,var(--blue)) 40%,transparent);background:color-mix(in srgb,var(--tone,var(--blue)) 18%,transparent)}
.frow.group{--tone:var(--blue)}
.frow .fic{width:15px;height:15px;color:var(--blue)}
.frow.group i{color:var(--blue);border-color:color-mix(in srgb,var(--blue) 25%,transparent)}
/* environment */
.env{margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}
.ehead{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.ehead .lbl{display:flex;align-items:center;gap:7px}
.ehead .lbl .i{width:13px;height:13px;color:var(--blue)}
.edot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}
.edot.off{background:var(--mut);box-shadow:none}
.enone{font-size:12px;line-height:1.55;color:var(--fg2)}
.enone code{font-family:var(--mono);font-size:11px;padding:0 4px;border-radius:4px;background:var(--hover);color:var(--fg)}
.erow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;border-bottom:1px dashed var(--border);font-family:var(--mono)}
.erow:last-child{border-bottom:0}
.erow span{font-size:11px;color:var(--fg2);flex:none}
.erow .val{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;font-weight:600;color:var(--fg);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.erow .val.green{color:var(--green);font-weight:500}.erow .val.blue{color:var(--blue);font-weight:500}
.erow .os{width:13px;height:13px;color:var(--green)}
/* ── main / views ── */
.main{min-width:0}
.view{display:none;padding:0 24px 32px}
.view.on{display:block}
#v-overview{display:block}
.js #v-overview:not(.on){display:none}
.vtitle .muted{font-size:13px;font-weight:500;margin-left:8px}
.vtitle{font-size:20px;font-weight:600;margin:0 -24px 22px;padding:20px 24px;border-bottom:1px solid var(--border);background:var(--bg2)}
.shead{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:28px 0 14px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 22px;box-shadow:0 1px 0 color-mix(in srgb,var(--fg) 4%,transparent),0 8px 24px -16px rgba(0,0,0,.5)}
.card .big{display:block;font-family:var(--mono);font-size:30px;font-weight:600;line-height:1.1;margin-bottom:10px}
.card p{font-size:12.5px;color:var(--fg2)}
.card.health{display:flex;align-items:center;gap:18px}
.card.health .ring{width:84px;height:84px}
.card.health .lbl{margin-bottom:6px}
.card.mix{display:grid;align-content:center;gap:10px}
.card.mix div{display:grid;grid-template-columns:62px 1fr 28px;align-items:center;gap:10px;font-size:12px;color:var(--fg2)}
.card.mix b{font-family:var(--mono);text-align:right;color:var(--fg)}
.track{height:6px;border-radius:3px;background:var(--hover);overflow:hidden}
.track i{display:block;height:100%;border-radius:3px}
.track .green{background:var(--green)}.track .red{background:var(--red)}.track .yellow{background:var(--yellow)}
/* ring */
.ring{position:relative;display:grid;place-items:center}
.ring svg{width:100%;height:100%}
.ring-bg{fill:none;stroke:var(--hover);stroke-width:8}
.ring-fg{fill:none;stroke-width:8;stroke-linecap:round}
.ring.green .ring-fg{stroke:var(--green);filter:drop-shadow(0 0 5px var(--green))}
.ring.yellow .ring-fg{stroke:var(--yellow);filter:drop-shadow(0 0 5px var(--yellow))}
.ring.red .ring-fg{stroke:var(--red);filter:drop-shadow(0 0 5px var(--red))}
.ring-mid{position:absolute;text-align:center;line-height:1.1}
.ring-mid b{font-family:var(--mono);font-size:19px;font-weight:700}
.ring.green .ring-mid b{color:var(--green)}.ring.yellow .ring-mid b{color:var(--yellow)}.ring.red .ring-mid b{color:var(--red)}
.card.health .ring-mid b{font-size:26px}
.ring-mid small{display:block;font-family:var(--mono);font-size:10px;color:var(--fg2);margin-top:4px}
/* attention */
.atts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.att{display:grid;text-align:left;gap:2px;padding:18px 20px;border-radius:12px;border:1px solid var(--border);border-left:4px solid var(--tone);cursor:pointer;
background:linear-gradient(90deg,color-mix(in srgb,var(--tone) 10%,var(--card)),var(--card) 60%)}
.att:hover{border-color:var(--tone)}
.att b{font-family:var(--mono);font-size:28px;line-height:1.2}
.att span{font-weight:600}
.att small{color:var(--fg2);font-size:12px}
.red{--tone:var(--red)}.orange{--tone:var(--orange)}.yellow{--tone:var(--yellow)}.purple{--tone:var(--purple)}.blue{--tone:var(--blue)}.green{--tone:var(--green)}
/* clusters */
.clusters{display:grid;gap:14px}
.cluster{border:1px solid var(--border);border-left:4px solid var(--tone);border-radius:12px;background:var(--card);padding:16px 18px;display:grid;gap:10px}
.cluster header{display:flex;align-items:center;gap:10px;color:var(--tone)}
.cluster header b{font-weight:600}
.cluster .count{margin-left:auto;font-family:var(--mono);font-size:11px;padding:2px 9px;border-radius:999px;background:var(--hover);color:var(--fg2);white-space:nowrap}
.cluster pre{margin:0}
.cluster small{font-family:var(--mono);font-size:11px;color:var(--mut)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;font-size:11px;padding:3px 9px;border-radius:6px;background:var(--hover);border:1px solid var(--border);color:var(--fg2);font-family:var(--mono);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.chip:hover{border-color:var(--glow);color:var(--fg)}
/* insights */
.insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.insight{display:flex;gap:16px;align-items:center;padding:18px 20px;border-radius:12px;border:1px solid var(--border);background:var(--card);min-width:0}
a.insight[href]:hover{border-color:var(--glow)}
.insight .ico{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:var(--hover);flex:none}
.insight .ico .i{width:20px;height:20px}
.insight>span:last-child{display:grid;min-width:0}
.insight small{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg2)}
.insight b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.insight em{font-style:normal;font-family:var(--mono);font-size:12px;color:var(--fg2)}
/* duration profile + pass ratio, side by side */
.panels{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:16px;margin-top:28px}
.panels>.panel{display:flex;flex-direction:column}
.panels .chart{flex:1;min-height:230px}
.ptitle{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;margin-bottom:4px}
.ptitle .i{color:var(--blue)}
.psub{font-size:12px;color:var(--fg2);margin-bottom:18px}
.donut-wrap{position:relative;display:grid;place-items:center;margin:4px 0 20px}
.donut{width:200px;height:200px}
.dtrack{fill:none;stroke:var(--hover);stroke-width:11}
.darc{fill:none;stroke-width:11}
.darc.green{stroke:var(--green);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--green) 60%,transparent))}
.darc.red{stroke:var(--red)}.darc.yellow{stroke:var(--yellow)}
.donut-mid{position:absolute;text-align:center;line-height:1.15}
.donut-mid b{display:block;font-family:var(--mono);font-size:28px;font-weight:700}
.donut-mid span{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg2);margin-top:4px}
.donut-mid small{display:block;font-family:var(--mono);font-size:11px;color:var(--fg2);margin-top:6px}
.dlegend{border-top:1px solid var(--border);padding-top:12px}
.dlegend div{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px}
.dlegend span{display:flex;align-items:center;gap:9px;color:var(--fg2)}
.dlegend i{width:8px;height:8px;border-radius:50%;background:var(--tone)}
.dlegend b{font-family:var(--mono);font-weight:600}
@media(max-width:1000px){.panels{grid-template-columns:1fr}}
/* chart */
.panel{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px}
.chart{height:230px;position:relative;background:repeating-linear-gradient(to bottom,transparent 0 45px,color-mix(in srgb,var(--border) 60%,transparent) 45px 46px)}
.bars{position:absolute;inset:0;display:flex;gap:10px;overflow-x:auto}
.bar-col{flex:1 0 38px;max-width:80px;display:grid;grid-template-rows:18px 1fr 22px;justify-items:center}
.bar-val,.bar-lbl{font-family:var(--mono);font-size:10px;color:var(--fg2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.bar-val{align-self:end}.bar-lbl{padding-top:6px}
.bar-wrap{width:100%;display:flex;align-items:flex-end}
.bar{display:block;width:100%;border-radius:5px 5px 0 0;min-height:2px}
.bar.passed{background:linear-gradient(180deg,var(--green),var(--green-d))}
.bar.failed{background:linear-gradient(180deg,var(--red),var(--red-d))}
.bar.skipped{background:linear-gradient(180deg,var(--yellow),var(--yellow-d))}
.bar-col:hover .bar{filter:brightness(1.2)}
/* tests split */
#v-tests{padding:0}
.split{display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr);height:calc(100vh - var(--top-h))}
.tlist{border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;background:var(--bg)}
.tlist-top{display:flex;align-items:center;gap:10px;padding:14px;border-bottom:1px solid var(--border)}
.input{flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);outline:none}
.input:focus{border-color:var(--blue)}
.tlist-top .mono{font-size:11px;white-space:nowrap}
.tlist-body{overflow-y:auto;padding:8px 10px 20px}
.lghead{display:flex;align-items:center;gap:8px;padding:14px 6px 8px;font-size:12px;font-weight:600;color:var(--fg2)}
.lghead span:first-of-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lghead .tag{margin-left:auto}
.titem{display:flex;align-items:center;gap:12px;padding:12px 14px;margin:6px 0;border-radius:10px;border:1px solid var(--border);background:var(--card)}
.titem:hover{border-color:var(--glow);background:var(--hover)}
.titem.on{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue) inset}
.titem.failed{border-left:3px solid var(--red)}
.tt{display:grid;min-width:0;flex:1}
.tt b{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt b em,.dtitle em{font-style:normal;font-family:var(--mono);color:var(--fg2);font-weight:500}
.failed .tt b em,.failed .dtitle em{color:var(--red)}
.tt small{font-family:var(--mono);font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td{font-family:var(--mono);font-size:12px;color:var(--fg2);white-space:nowrap}
.tdetail{overflow-y:auto;padding:24px 28px 40px;min-width:0}
.detail{display:none}
.detail.on{display:block}
.tdetail:has(.detail.on) .pick{display:none}
.dhead{display:flex;align-items:flex-start;gap:14px;padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.dhead>.dot{margin-top:9px}
.dtitle{flex:1;min-width:240px}
.dtitle h3{font-size:18px;font-weight:600;line-height:1.35;margin-bottom:8px}
.dmeta{display:flex;flex-wrap:wrap;gap:6px}
.dstat{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dstat .mono{font-size:14px}
/* one size for every chip in the header row: same height, padding, type */
.dstat .tag,.dstat .pill,.dstat .speed,.dmeta .chip,.dmeta .tag{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:26px;padding:0 10px;
border-radius:6px;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;line-height:1;white-space:nowrap}
.dstat .speed{border:1px solid color-mix(in srgb,currentColor 45%,transparent);background:color-mix(in srgb,currentColor 10%,transparent);letter-spacing:0}
.dstat .pill.failed{box-shadow:none}
.dmeta .chip{font-weight:500;letter-spacing:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;display:inline-block;line-height:24px}
.dmeta{align-items:center}
.tag{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:5px;
color:var(--tone);border:1px solid color-mix(in srgb,var(--tone) 55%,transparent);background:color-mix(in srgb,var(--tone) 10%,transparent);white-space:nowrap}
.pill{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:6px;border:1px solid}
.pill.passed{color:var(--green);border-color:var(--green)}
.pill.failed{color:var(--red);border-color:var(--red);box-shadow:0 0 12px -4px var(--red)}
.pill.skipped{color:var(--yellow);border-color:var(--yellow)}
/* detail blocks */
.block{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:16px 18px;margin-bottom:16px}
.block h4,.block>summary{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2);margin-bottom:12px}
.block>summary{list-style:none;cursor:pointer;margin:0}
.block>summary::-webkit-details-marker{display:none}
.block>summary::after{content:"▸";margin-left:auto;transition:transform .15s}
.block[open]>summary{margin-bottom:12px}
.block[open]>summary::after{transform:rotate(90deg)}
.block h4 .cnt{font-family:var(--mono);font-size:10px;padding:1px 8px;border-radius:999px;background:var(--hover);letter-spacing:0}
.block h4 b{margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:0;text-transform:none;color:var(--fg)}
.sec.why{border-left:4px solid var(--blue);background:linear-gradient(90deg,color-mix(in srgb,var(--blue) 8%,var(--card)),var(--card) 70%)}
.sec.why h4{color:var(--blue)}
.sec.why p{font-size:14.5px}
.sec.why p.next{margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);font-size:13px;color:var(--fg2)}
.sec.raw{border-left:4px solid var(--red)}
.sec.raw>summary{color:var(--red)}
.sec.media h4{color:var(--orange)}
.timeline{display:flex;height:36px;border-radius:7px;overflow:hidden;gap:2px;background:var(--hover)}
.seg{display:block;min-width:4px}
.k-nav{background:var(--blue)}.k-action{background:var(--purple)}.k-input{background:var(--green-d)}
.k-check{background:var(--yellow-d)}.k-other{background:var(--mut)}.k-fail{background:var(--red)}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:8px 0 14px;font-size:11px;color:var(--fg2)}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:9px;height:9px;border-radius:2px;min-width:0;flex:none}
.steps ol{list-style:none;display:grid;gap:6px}
.steps li{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-family:var(--mono);font-size:12.5px}
.steps li.slowest{border-color:var(--orange);color:var(--orange);background:color-mix(in srgb,var(--orange) 8%,transparent)}
.steps li.failed{border-color:var(--red);background:color-mix(in srgb,var(--red) 9%,transparent)}
.steps .n{color:var(--mut);min-width:18px;text-align:right;font-size:11px}
.steps .st{flex:1;min-width:120px;word-break:break-word}
.steps .st em{display:block;font-style:normal;color:var(--red);font-size:11.5px;margin-top:3px}
.steps .sbar{flex:0 0 180px;height:5px;border-radius:3px;background:var(--hover);overflow:hidden}
.steps .sbar i{display:block;height:100%;border-radius:3px;background:var(--blue)}
.steps li.slowest .sbar i{background:var(--orange)}.steps li.failed .sbar i{background:var(--red)}
.steps .sms{min-width:52px;text-align:right;color:var(--fg2)}
.steps li.slowest .sms{color:var(--orange)}
pre{font-family:var(--mono);font-size:12px;line-height:1.6;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto}
pre.err{white-space:pre-wrap;word-break:break-word}
pre .hl{color:var(--red);font-weight:600}pre .dim{color:var(--mut)}pre .own{color:var(--blue)}
.shot{margin:0}
.shot img{max-width:280px;max-height:520px;border-radius:10px;border:1px solid var(--border);display:block;cursor:zoom-in}
.shot figcaption{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:8px}
/* gallery */
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.gitem{display:grid;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card)}
.gitem:hover{border-color:var(--red)}
.gitem img{width:100%;aspect-ratio:9/16;object-fit:cover;object-position:top;background:var(--bg);display:block}
.gitem span{display:grid;padding:10px 12px;border-top:1px solid var(--border)}
.gitem b{font-family:var(--mono);font-size:12px;color:var(--red)}
.gitem small{font-size:11.5px;color:var(--fg2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lightbox{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(0,0,0,.82);padding:24px}
.lightbox img{max-width:min(92vw,560px);max-height:88vh;border-radius:12px}
.lightbox .iconbtn{position:absolute;top:16px;right:16px}
.foot{padding:14px 24px;border-top:1px solid var(--border);font-family:var(--mono);font-size:11px;color:var(--mut);text-align:center}
/* sidebar tiles */
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:14px 0 16px;border-bottom:1px solid var(--border)}
.tile{display:grid;justify-items:center;gap:2px;padding:11px 0;border:1px solid var(--border);border-radius:10px;background:var(--card);cursor:pointer}
.tile:hover:not(:disabled){border-color:var(--tone)}
.tile:disabled{cursor:default}
.tile.on{border-color:var(--tone);box-shadow:0 0 14px -5px var(--tone)}
.tile b{font-family:var(--mono);font-size:19px;line-height:1.2;color:var(--tone)}
.tile small{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg2)}
/* overview additions */
.bigrow{display:flex;align-items:center;gap:10px;margin-bottom:10px}.bigrow .big{margin:0}
.delta{font-family:var(--mono);font-size:12px;font-weight:600;padding:2px 7px;border-radius:5px}
.delta.good{color:var(--green);background:color-mix(in srgb,var(--green) 14%,transparent)}
.delta.bad{color:var(--red);background:color-mix(in srgb,var(--red) 14%,transparent)}
.delta.flat{color:var(--fg2);background:var(--hover)}
.mut{--tone:var(--mut)}.track .mut{background:var(--mut)}
.more{display:inline-block;margin-top:10px;font-size:12px;color:var(--blue)}
/* trends */
.thead2{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin:0 -24px 22px;padding:18px 24px;border-bottom:1px solid var(--border);background:var(--bg2)}
.thead2 h2{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600}
.thead2 .runs{font-family:var(--mono);font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--hover);color:var(--fg2)}
.thead2 p{font-size:12.5px;color:var(--fg2);margin-top:4px}
.tactions{display:flex;gap:10px;flex-wrap:wrap}
.tbtn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);font-size:12.5px;font-weight:500;color:var(--fg)}
a.tbtn:hover{border-color:var(--glow);background:var(--hover)}
.tbtn .i{width:14px;height:14px;color:var(--fg2)}
.tbtn.static{cursor:default;color:var(--fg2)}
.tbtn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 50%,transparent);background:color-mix(in srgb,var(--red) 12%,transparent)}
.tbtn.danger .i{color:var(--red)}
.tgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:18px}
.tcard{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:16px 18px 12px}
.tcard>header{display:flex;align-items:center;gap:9px;margin-bottom:14px;flex-wrap:wrap}
.tcard h4{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.tdot{width:8px;height:8px;border-radius:50%;background:var(--tone);box-shadow:0 0 6px var(--tone)}
.tctx{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--fg2)}
.tbadge{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;color:var(--tone);border:1px solid color-mix(in srgb,var(--tone) 50%,transparent);background:color-mix(in srgb,var(--tone) 12%,transparent)}
.tplot{--tone:var(--blue)}
.tplot.red{--tone:var(--red)}.tplot.yellow{--tone:var(--yellow)}.tplot.blue{--tone:var(--blue)}
.tarea{position:relative;height:170px}
.tarea svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.gs1{stop-color:var(--tone);stop-opacity:.34}.gs2{stop-color:var(--tone);stop-opacity:.02}
.tline{fill:none;stroke:var(--tone);stroke-width:2.5}
.tline.alert{stroke:var(--red)}
.spt.alert{--tone:var(--red)}
.tbarcol{position:absolute;bottom:0;top:0;width:9%;transform:translateX(-50%);display:flex;align-items:flex-end}
.tbar2{position:relative;display:block;width:100%;border-radius:5px 5px 0 0;background:color-mix(in srgb,var(--tone) 22%,transparent);border-top:2px solid color-mix(in srgb,var(--tone) 45%,transparent);cursor:pointer;outline:none}
.tbar2:hover,.tbar2:focus-visible{background:color-mix(in srgb,var(--tone) 34%,transparent)}
/* The current run stands out by shape and a top edge, not by a wall of solid colour. */
.tbar2.cur{background:linear-gradient(180deg,color-mix(in srgb,var(--tone) 62%,transparent),color-mix(in srgb,var(--tone) 18%,transparent));border-top-color:var(--tone);box-shadow:0 -2px 10px -6px var(--tone)}
.tbar2::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:5;min-width:220px;max-width:300px;padding:9px 11px;border-radius:9px;border:1px solid var(--border);
background:var(--bg2);color:var(--fg);font:500 12px/1.55 var(--mono);text-align:left;white-space:pre-line;box-shadow:0 14px 34px -10px rgba(0,0,0,.6);opacity:0;pointer-events:none;transition:opacity .12s}
.tbar2.tl::after{left:0;transform:none}.tbar2.tr::after{left:auto;right:0;transform:none}
.tbar2:hover::after,.tbar2:focus-visible::after{opacity:1}
.tlab{position:relative;height:30px;margin-top:10px;border-top:1px solid var(--border)}
.tlab span{position:absolute;top:8px;transform:translateX(-50%);font-family:var(--mono);font-size:10.5px;color:var(--fg2);white-space:nowrap}
.tlab span.cur.alert{--tone:var(--red)}
.tlab span.cur{padding:1px 6px;border-radius:4px;color:var(--tone);font-weight:700;border:1px solid color-mix(in srgb,var(--tone) 50%,transparent);background:color-mix(in srgb,var(--tone) 12%,transparent);top:5px}
.rmatrix{border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden}
.rmatrix>header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.rmatrix>header .i{color:var(--blue)}
.rmatrix>header b{font-family:var(--mono);font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.rmatrix>header .muted{font-family:var(--mono);font-size:11px}
.spect{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--fg2)}
.htable{width:100%;border-collapse:collapse;font-size:13px}
.htable th{padding:11px 16px;text-align:right;font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2);border-bottom:1px solid var(--border)}
.htable td{padding:11px 16px;text-align:right;font-family:var(--mono);border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);white-space:nowrap}
.htable th:first-child,.htable td:first-child{text-align:left}
.htable th:last-child,.htable td:last-child{text-align:center}
.htable tr.cur td{background:color-mix(in srgb,var(--red) 6%,transparent)}
.htable tr.cur td:first-child{box-shadow:inset 3px 0 0 var(--red)}
.htable td.g{color:var(--green)}.htable td.r{color:var(--red)}.htable td.y{color:var(--yellow)}.htable td.b{color:var(--blue);font-weight:700}
.htable td.rate{font-weight:700}
.rts{font-weight:600;color:var(--fg)}
.thisrun{margin-left:10px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:var(--blue);border:1px solid color-mix(in srgb,var(--blue) 50%,transparent);background:color-mix(in srgb,var(--blue) 12%,transparent)}
.runno{margin-left:8px;font-size:11px;color:var(--mut)}
.ract{font-size:11px;font-weight:600;padding:3px 9px;border-radius:5px;border:1px solid var(--border);background:var(--hover)}
.ract:hover{border-color:var(--glow)}
.rexp{width:26px;height:26px;border-radius:6px;border:1px solid transparent;background:none;color:var(--fg2);font-size:17px;line-height:1;cursor:pointer;transition:transform .15s}
.rexp:hover{border-color:var(--border);background:var(--hover);color:var(--fg)}
.rexp.open{transform:rotate(90deg);color:var(--blue)}
.rdetail td{background:var(--bg);text-align:left!important;white-space:normal}
.rdgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:4px 2px}
.rdgrid small{display:block;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--fg2);margin-bottom:6px}
.rdgrid span{display:block;font-size:12px;color:var(--fg);margin-bottom:3px}.rdgrid span.g{color:var(--green)}.rdgrid span.r{color:var(--red)}
.rdgrid em{font-style:normal;font-size:12px;color:var(--mut)}
@media(max-width:1100px){.tgrid{grid-template-columns:1fr}.rdgrid{grid-template-columns:1fr}}
/* comparison: metric matrix + delta cards */
.matrix{border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden}
.matrix>header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border)}
.matrix>header .i{color:var(--blue)}
.matrix>header b{font-family:var(--mono);font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.matrix>header span,.dhead2 span{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--mut)}
.mtable{width:100%;border-collapse:collapse;font-size:13px}
.mtable th{padding:12px 20px;text-align:right;font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2);border-bottom:1px solid var(--border)}
.mtable td{padding:11px 20px;text-align:right;font-family:var(--mono);border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);white-space:nowrap}
.mtable th:first-child,.mtable td:first-child{text-align:left}
.mtable tr:last-child td{border-bottom:0}
.mtable tr.worse td{background:color-mix(in srgb,var(--red) 7%,transparent)}
.mtable td.now{font-weight:700;color:var(--fg)}
.mtable td.g{color:var(--green)}.mtable td.r{color:var(--red)}.mtable td.y{color:var(--yellow)}
.mlabel{display:inline-flex;align-items:center;gap:10px;font-family:var(--sans);color:var(--fg)}
.mlabel .i{width:15px;height:15px;color:var(--fg2)}
.mlabel .i.green{color:var(--green)}.mlabel .i.red{color:var(--red)}.mlabel .i.yellow{color:var(--yellow)}.mlabel .i.blue{color:var(--blue)}
.dbadge{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:22px;padding:0 7px;border-radius:5px;font-family:var(--mono);font-size:11px;font-weight:700;border:1px solid}
.dbadge.flat{color:var(--fg2);border-color:var(--border);background:var(--hover)}
.dbadge.good{color:var(--green);border-color:color-mix(in srgb,var(--green) 50%,transparent);background:color-mix(in srgb,var(--green) 12%,transparent)}
.dbadge.bad{color:var(--red);border-color:color-mix(in srgb,var(--red) 55%,transparent);background:color-mix(in srgb,var(--red) 12%,transparent)}
.dbadge.bad.strong{color:#fff;background:var(--red);border-color:var(--red)}
.dhead2{display:flex;align-items:center;gap:10px;margin:26px 0 12px}
.dhead2 .i{color:var(--fg2)}
.dhead2 b{font-family:var(--mono);font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.dgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.dcard{display:flex;flex-direction:column;min-height:230px;border:1px solid color-mix(in srgb,var(--tone) 55%,var(--border));border-radius:12px;background:var(--card)}
.dcard.teal{--tone:color-mix(in srgb,var(--green) 55%,var(--blue))}
.dcard>header{display:flex;align-items:center;justify-content:space-between;margin:0 16px;padding:14px 0 12px;border-bottom:1px solid var(--border)}
.dcard h4{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tone)}
.dcount{min-width:22px;height:22px;padding:0 6px;display:grid;place-items:center;border-radius:5px;font-family:var(--mono);font-size:11px;font-weight:700;
color:var(--tone);border:1px solid color-mix(in srgb,var(--tone) 55%,transparent);background:color-mix(in srgb,var(--tone) 15%,transparent)}
.dbody{flex:1;display:flex;flex-direction:column;gap:8px;padding:12px 16px 16px}
.ditem{display:grid;gap:4px;padding:10px 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--tone) 35%,transparent);background:color-mix(in srgb,var(--tone) 7%,var(--bg))}
.ditem:hover{border-color:var(--tone)}
.dtitle{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsub{display:flex;justify-content:space-between;gap:10px;font-family:var(--mono);font-size:11px;color:var(--tone)}
.dsub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsub em{font-style:normal;font-weight:700;flex:none}
.dline{font-family:var(--mono);font-size:12.5px;color:var(--fg);padding:2px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.dline:hover{color:var(--tone)}
.tcid{color:var(--tone);font-weight:600}
.dtitle .tcid{color:var(--fg)}
.dmore{font-family:var(--mono);font-size:11px;color:var(--mut)}
.dempty{flex:1;display:grid;place-content:center;justify-items:center;gap:6px;text-align:center}
.dicon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--tone);background:color-mix(in srgb,var(--tone) 18%,transparent)}
.dicon .i{width:16px;height:16px}
.dempty b{font-family:var(--mono);font-size:12.5px;font-weight:600;color:var(--fg2)}
.dempty small{font-family:var(--mono);font-size:11px;color:var(--mut)}
@media(max-width:1100px){.dgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.dgrid{grid-template-columns:1fr}}
/* quality gates + quarantine registry */
.qpanel{margin-top:18px;border:1px solid color-mix(in srgb,var(--tone) 30%,var(--border));border-radius:14px;background:var(--card);box-shadow:0 8px 24px -16px rgba(0,0,0,.5)}
.qhead{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.qicon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;border:1px solid color-mix(in srgb,var(--tone) 45%,transparent);background:color-mix(in srgb,var(--tone) 12%,transparent);color:var(--tone);flex:none}
.qtitle{display:grid;min-width:0}.qtitle b{font-size:16px;font-weight:600}.qtitle small{font-size:12px;color:var(--fg2)}
.qright{margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.qrun{font-family:var(--mono);font-size:12px;color:var(--fg2)}
.qbadge{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--tone) 55%,transparent);
background:color-mix(in srgb,var(--tone) 14%,transparent);color:var(--tone);font-family:var(--mono);font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.qbadge i{position:relative;width:7px;height:7px;border-radius:50%;background:var(--tone);box-shadow:0 0 6px var(--tone);animation:qpulse 1.6s ease-in-out infinite}
.qbadge i::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--tone);animation:qring 1.6s ease-out infinite}
@keyframes qpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.8)}}
@keyframes qring{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(3)}}
@media(prefers-reduced-motion:reduce){.qbadge i,.qbadge i::after{animation:none}}
.qbody{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:18px;padding:18px 20px 20px}
.qlh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.qlh small{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2)}
.qlh span{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tone)}
.rule,.qitem{display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;background:var(--bg)}
.rmark{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;font-size:13px;font-weight:700;flex:none;
color:var(--rt);border:1px solid color-mix(in srgb,var(--rt) 45%,transparent);background:color-mix(in srgb,var(--rt) 14%,transparent)}
.rule.ok{--rt:var(--green)}.rule.no{--rt:var(--red)}.rule.skip{--rt:var(--mut)}
.rtext,.qmain{display:grid;min-width:0;flex:1}
.rtext b,.qmain b{font-size:13.5px;font-weight:600;line-height:1.4}
.rtext small,.qmain small{font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--fg2)}
.rval,.qscore{display:grid;justify-items:end;gap:3px;flex:none;text-align:right}
.rval span{font-family:var(--mono);font-size:12px;color:var(--fg2)}
.rval span b{font-size:17px;font-weight:700;color:var(--rt);margin-right:4px}
.rval span i{font-style:normal}
.rval em,.qscore em{font-style:normal;font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--rt)}
.qitem:hover{border-color:var(--glow)}
.tctag{display:inline-block;margin-right:8px;padding:1px 7px;border-radius:5px;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--orange);
border:1px solid color-mix(in srgb,var(--orange) 50%,transparent);background:color-mix(in srgb,var(--orange) 12%,transparent)}
.qscore b{font-family:var(--mono);font-size:17px;font-weight:700;color:var(--yellow)}
.qscore em{--rt:var(--yellow);padding:2px 7px;border-radius:5px;border:1px solid color-mix(in srgb,var(--yellow) 45%,transparent);background:color-mix(in srgb,var(--yellow) 12%,transparent)}
.qfoot{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:var(--fg2)}
.qfoot .i{width:14px;height:14px;color:var(--tone)}
.qchart{display:flex;flex-direction:column;padding:16px 18px;border:1px solid var(--border);border-radius:12px;background:var(--bg)}
.qch{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.qch h4{font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.qch p{font-size:11.5px;color:var(--fg2);margin-top:2px}
.qlegend{display:grid;gap:4px;font-size:11px;color:var(--fg2)}
.qlegend span{display:flex;align-items:center;gap:7px}
.qlegend .ln{width:14px;height:2px;background:var(--tone)}
.qlegend .dash{width:14px;height:0;border-top:2px dashed var(--blue)}
.qtarget{font-family:var(--mono);font-size:11px;padding:4px 9px;border-radius:6px;color:var(--orange);border:1px solid color-mix(in srgb,var(--orange) 45%,transparent);background:color-mix(in srgb,var(--orange) 10%,transparent)}
.achart{flex:1;display:flex;flex-direction:column;min-height:220px}
.achart.green{--tone:var(--green)}.achart.red{--tone:var(--red)}.achart.yellow{--tone:var(--yellow)}
.achart.empty{display:grid;place-items:center;color:var(--fg2);font-size:12.5px}
.aplot{position:relative;flex:1;margin-left:38px;min-height:190px}
.aplot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.afill{fill:color-mix(in srgb,var(--tone) 18%,transparent)}
.aline{fill:none;stroke:var(--tone);stroke-width:2.5}
.gl{position:absolute;left:0;right:0;border-top:1px dashed color-mix(in srgb,var(--border) 90%,transparent)}
.gl span{position:absolute;right:calc(100% + 8px);top:-7px;font-family:var(--mono);font-size:10px;color:var(--mut)}
.gl.th span{color:var(--blue);font-weight:700}
.thr{position:absolute;left:0;right:0;border-top:2px dashed color-mix(in srgb,var(--blue) 80%,transparent)}
.callout{position:absolute;transform:translate(-115%,-150%);padding:3px 8px;border-radius:6px;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--tone);
border:1px solid var(--tone);background:var(--card);pointer-events:none;white-space:nowrap}
.axl{position:relative;height:34px;margin:8px 0 0 38px}
.axl span{position:absolute;transform:translateX(-50%);display:grid;justify-items:center;font-family:var(--mono);font-size:10px;color:var(--mut);white-space:nowrap}
.axl small{font-size:9.5px;opacity:.85}
.axl span.cur{color:var(--tone);font-weight:700}
.qcf{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--fg2)}
.qcf span{display:flex;align-items:center;gap:6px}.qcf .i{width:13px;height:13px;color:var(--yellow)}
.qcf .bad{color:var(--red);font-family:var(--mono)}.qcf .good{color:var(--green);font-family:var(--mono)}
@media(max-width:1100px){.qbody{grid-template-columns:1fr}}
.spt{position:absolute;z-index:3;width:10px;height:10px;margin:-5px 0 0 -5px;padding:0;border-radius:50%;border:2px solid var(--tone);
background:var(--card);cursor:pointer;transition:transform .12s}
.spt.cur{background:var(--tone);box-shadow:0 0 8px var(--tone)}
.spt:hover,.spt:focus-visible{transform:scale(1.5);outline:none;background:var(--tone)}
.spt::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%) scale(.667);transform-origin:bottom center;
min-width:240px;max-width:320px;padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg2);color:var(--fg);
font:500 12px/1.55 var(--mono);text-align:left;white-space:pre-line;box-shadow:0 14px 34px -10px rgba(0,0,0,.6);opacity:0;pointer-events:none;transition:opacity .12s}
.spt.tl::after{left:-4px;transform:scale(.667);transform-origin:bottom left}
.spt.tr::after{left:auto;right:-4px;transform:scale(.667);transform-origin:bottom right}
.spt:hover::after,.spt:focus-visible::after{opacity:1}
.strip{display:flex;align-items:flex-end;gap:3px;height:30px;margin-top:4px}
.strip i{display:block;width:14px;border-radius:2px;background:var(--tone)}
.ttags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.ttags .tag{font-size:9.5px;padding:1px 6px}
.dmeta .tag{align-self:center}
.speed{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:12px;font-weight:600}
.speed .i{width:13px;height:13px}.speed.good{color:var(--green)}.speed.bad{color:var(--red)}
/* per-test history */
.hist h4 .muted{text-transform:none;letter-spacing:0;font-weight:500}
.hgrid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.hgrid .lbl{margin-bottom:10px}
.hgrid p{font-size:11.5px;margin-top:10px}
.hdots{display:flex;gap:6px;flex-wrap:wrap}
.hdots i{width:11px;height:11px;border-radius:50%;background:var(--mut)}
.hdots i.passed{background:var(--green)}.hdots i.failed{background:var(--red)}.hdots i.skipped{background:var(--yellow)}
.hdots i.cur{box-shadow:0 0 0 2px var(--card),0 0 0 3.5px var(--fg)}
.hbars{display:flex;align-items:flex-end;gap:4px;height:34px}
.hbars i{display:block;width:12px;border-radius:2px 2px 0 0;background:color-mix(in srgb,var(--blue) 55%,transparent)}
.hbars i.cur{background:var(--blue)}
/* trends */
.tcharts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
.ph{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--fg2);margin-bottom:14px}
.ph i{font-style:normal;font-family:var(--mono);font-size:11px;padding:1px 8px;border-radius:999px;background:var(--hover);color:var(--fg);letter-spacing:0}
.trend{position:relative;padding-bottom:22px}
.trend svg{display:block;width:100%;height:150px;overflow:visible}
.trend.green{--tone:var(--green)}.trend.blue{--tone:var(--blue)}.trend.red{--tone:var(--red)}.trend.yellow{--tone:var(--yellow)}
.tbar{fill:color-mix(in srgb,var(--tone) 50%,transparent)}.tbar.cur{fill:var(--tone)}
.tlabels{position:absolute;left:0;right:0;bottom:0;height:18px}
.tlabels span{position:absolute;transform:translateX(-50%);font-family:var(--mono);font-size:10px;color:var(--fg2);white-space:nowrap}
.tlabels span:last-child{color:var(--fg);font-weight:600}
.tablewrap{overflow-x:auto;padding:0}
.rtable{width:100%;border-collapse:collapse;font-size:13px}
.rtable th,.rtable td{padding:11px 16px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}
.rtable th:first-child,.rtable td:first-child{text-align:left}
.rtable th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--fg2);background:var(--bg2)}
.rtable td{font-family:var(--mono)}.rtable td:first-child{font-family:var(--sans)}
.rtable tr:last-child td{border-bottom:0}
.rtable tr.cur td{background:color-mix(in srgb,var(--blue) 6%,transparent)}
.rtable .g{color:var(--green)}.rtable .r{color:var(--red)}.rtable .y{color:var(--yellow)}
/* comparison */
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
.cbox{border-top:3px solid var(--tone)}
.clist{list-style:none;display:grid;gap:6px;font-size:13px}
.clist li{display:flex;gap:10px;justify-content:space-between;min-width:0}
.clist a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.clist a:hover{color:var(--blue)}
.clist em{font-style:normal;font-family:var(--mono);font-size:12px;flex:none}.clist .bad{color:var(--red)}.clist .good{color:var(--green)}
.empty-state{display:grid;justify-items:center;gap:10px;text-align:center;padding:48px 24px;color:var(--fg2)}
.empty-state .i{width:28px;height:28px;color:var(--blue)}
.empty-state b{color:var(--fg);font-size:16px}
.empty-state p{max-width:520px;font-size:13px}
.empty-state code{font-family:var(--mono);font-size:12px;padding:1px 6px;border-radius:4px;background:var(--hover)}
/* ── responsive ── */
@media(max-width:1200px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.search{width:200px}.tcharts{grid-template-columns:1fr}}
@media(max-width:1060px){.topbtn span{display:none}.stamp{display:none}}
@media(max-width:900px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .side{position:fixed;left:0;top:var(--top-h);z-index:30;width:var(--side-w);transform:translateX(-100%);transition:transform .2s;box-shadow:12px 0 32px rgba(0,0,0,.4)}
  body.side-open .side{transform:none}
  .crumb,.stamp,kbd{display:none}
  .hgrid{grid-template-columns:1fr}
  .split{grid-template-columns:minmax(0,1fr);height:auto}
  .tlist{border-right:0;border-bottom:1px solid var(--border)}
  .tlist-body{max-height:45vh}
  .steps .sbar{flex-basis:80px}
}
@media(max-width:620px){
  .top{gap:8px;padding:0 10px}.brand small{display:none}.brand b{max-width:140px}
  .search{width:auto;flex:1;min-width:0;margin-left:0}.search kbd{display:none}
  .themesel{padding:0 8px}.themesel select{position:absolute;inset:0;width:100%;opacity:0}.themesel{position:relative;width:36px;justify-content:center}
  .cards{grid-template-columns:1fr}.view{padding:0 16px 24px}.vtitle{margin:0 -16px 18px;padding:16px}
  .tdetail{padding:18px 16px}.steps .sbar{display:none}
}
/* ── print / Save as PDF ────────────────────────────────────────────────
   Light palette to save ink, every section on its own page, and no card,
   chart, table row or test block split across a page break. */
.print-only{display:none}
@page{size:A4;margin:14mm 12mm}
@media print{
  :root,:root[data-theme]{${LIGHT};color-scheme:light}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{background:#fff!important;scrollbar-gutter:auto}
  body{font-size:12px}
  .top,.side,.tlist,.lightbox,.foot,.iconbtn,.tactions,.search,.export,.themesel,.stamp,.rexp,.qcf,.linkbtn{display:none!important}
  .print-only{display:block}
  .shell{display:block}
  .main,.view,.split,.tdetail{display:block!important;height:auto!important;overflow:visible!important;padding:0!important;margin:0}
  .view{break-before:page}
  #v-overview{break-before:auto}
  .vtitle,.thead2{margin:0 0 14px!important;padding:0 0 10px!important;background:none!important;border-bottom:2px solid var(--border)}
  .detail{display:block!important;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)}
  .detail+.detail{break-before:auto}
  .pick,.empty.pick{display:none!important}
  /* Keep whole: cards, panels, charts, rows. */
  .card,.att,.insight,.cluster,.panel,.rule,.qitem,.qchart,.qhead,.tcard,.dcard,.ditem,.matrix,.rmatrix>header,.block,.shot,.gitem,
  .dhead,tr,.lgroup,.env,.panels>section,figure,pre{break-inside:avoid;page-break-inside:avoid}
  .qpanel,.qbody,.rmatrix,.dgrid,.tgrid,.cards,.atts,.clusters,.insights,.panels{break-inside:auto}
  thead{display:table-header-group}
  h2,h3,h4,.shead,.dhead2,.qlh,.qhead,.qch,.lghead{break-after:avoid;page-break-after:avoid}
  /* Grids narrow enough for an A4 page. */
  .cards{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .qbody,.tgrid,.panels{grid-template-columns:1fr!important}
  .dgrid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .gallery{grid-template-columns:repeat(4,minmax(0,1fr))!important}
  .dcard{min-height:0}
  .tarea{height:140px}.achart{min-height:170px}.aplot{min-height:140px}
  /* Hover-only bits have no meaning on paper. */
  .spt::after,.tbar2::after{display:none!important}
  .qbadge i,.qbadge i::after{animation:none!important}
  .sec.raw{display:block}.sec.raw>summary::after{display:none}
  .sec.raw[open] pre,.sec.raw pre{display:block}
  .shot img{max-height:320px}
  a{color:inherit;text-decoration:none}
  .noprint{display:none!important}
  pre,pre.err{white-space:pre-wrap!important;word-break:break-word;overflow:visible!important}
  .panels{grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr)!important}
  .donut{width:160px;height:160px}
  /* Test header: title on its own line, chips below, and never left alone at a page foot. */
  .dhead{flex-direction:column;align-items:stretch;gap:8px;break-after:avoid;page-break-after:avoid}
  .dhead>.dot{display:none}
  .dtitle{min-width:0}.dtitle h3{white-space:normal}
  .dstat{justify-content:flex-start}
  /* Bars share the width on paper; a scrollbar cannot be scrolled in a PDF. */
  .bars{overflow:hidden!important;gap:6px}.bar-col{flex:1 1 0!important;min-width:0!important;max-width:none}
  .tablewrap{overflow:visible!important}
  /* Tables fit the page: no Action column (nothing to click on paper), tighter cells. */
  .htable th:last-child,.htable td:last-child{display:none}
  .htable th,.htable td,.mtable th,.mtable td{padding:8px 10px}
  .htable,.mtable{font-size:11.5px}
  .rdetail{display:none!important}
}`;
}

function clientJs() {
  return `(function(){
document.documentElement.classList.add('js');
var $=function(s,r){return (r||document).querySelector(s)}, $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
var views={overview:'Overview',tests:'Tests',trends:'Trends',comparison:'Comparison',gallery:'Gallery'};
var cur=null, filters={att:null,st:null,kind:null,group:null}, q=$('#q'), tf=$('#tf');
function show(view,id){
  $$('.view').forEach(function(v){v.classList.toggle('on',v.dataset.view===view)});
  $$('[data-nav]').forEach(function(a){a.classList.toggle('on',a.dataset.nav===view)});
  var crumb=views[view];
  $$('.detail').forEach(function(d){d.classList.toggle('on',d.dataset.id===id)});
  $$('.titem').forEach(function(t){t.classList.toggle('on',t.dataset.id===id)});
  if(id){var d=$('#d-'+id); if(d) crumb=d.querySelector('h3').textContent; var it=$('.titem[data-id="'+id+'"]'); if(it&&it.scrollIntoView) it.scrollIntoView({block:'nearest'});}
  $('#crumb').textContent=crumb;
  document.body.classList.remove('side-open');
  if(view!==cur){window.scrollTo(0,0); cur=view;}
}
function route(){
  var h=location.hash.slice(1);
  if(/^t\\d+$/.test(h)) return show('tests',h);
  if(views[h]) {
    if(h==='tests'&&!$('.detail.on')){var f=$('.titem.failed')||$('.titem'); if(f) return show('tests',f.dataset.id);}
    return show(h,h==='tests'&&$('.detail.on')?$('.detail.on').dataset.id:null);
  }
  show('overview',null);
}
function apply(){
  var term=((q.value||'')+' '+(tf.value||'')).trim().toLowerCase(), shown=0, any=false;
  $$('.titem').forEach(function(t){
    var d=$('#d-'+t.dataset.id), text=(t.textContent+' '+(d?d.textContent:'')).toLowerCase();
    var ok=(!filters.att||(' '+t.dataset.att+' ').indexOf(' '+filters.att+' ')>-1)&&(!filters.st||t.dataset.st===filters.st)&&(!filters.kind||t.dataset.kind===filters.kind)&&(!filters.group||t.dataset.group===filters.group)
      &&(!term||term.split(/\\s+/).every(function(w){return text.indexOf(w)>-1}));
    t.hidden=!ok; if(ok) shown++;
  });
  $$('.lgroup').forEach(function(g){g.hidden=!$$('.titem',g).some(function(t){return !t.hidden})});
  for(var k in filters) if(filters[k]) any=true;
  $('#fclear').disabled=!any;
  $('#tcount').textContent=shown+' / '+$$('.titem').length;
}
$$('[data-f]').forEach(function(b){b.addEventListener('click',function(){
  var f=b.dataset.f, v=b.dataset.v; filters[f]=filters[f]===v?null:v;
  $$('[data-f="'+f+'"]').forEach(function(x){x.classList.toggle('on',filters[f]===x.dataset.v)});
  apply(); if(location.hash.slice(1)!=='tests'&&!/^#t\\d+$/.test(location.hash)) location.hash='tests';
})});
$('#fclear').addEventListener('click',function(){for(var k in filters) filters[k]=null; $$('[data-f]').forEach(function(x){x.classList.remove('on')}); apply();});
$$('[data-go]').forEach(function(b){b.addEventListener('click',function(e){
  e.preventDefault(); var p=b.dataset.go.split(':'); var chip=$('[data-f="'+p[0]+'"][data-v="'+p[1]+'"]'); if(chip&&!chip.classList.contains('on')) chip.click(); location.hash='tests';
})});
q.addEventListener('input',function(){apply(); if(q.value&&!/^#?(tests|t\\d+)$/.test(location.hash.slice(1))) location.hash='tests';});
tf.addEventListener('input',apply);
document.addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); q.focus(); q.select();}
  if(e.key==='Escape') $('#lb').hidden=true;
  if((e.key==='j'||e.key==='k')&&!/INPUT|SELECT/.test(document.activeElement.tagName)&&$('#v-tests').classList.contains('on')){
    var items=$$('.titem').filter(function(t){return !t.hidden}), i=items.findIndex(function(t){return t.classList.contains('on')});
    var n=items[Math.max(0,Math.min(items.length-1,i+(e.key==='j'?1:-1)))]; if(n) location.hash=n.dataset.id;
  }
});
$('#menu').addEventListener('click',function(){document.body.classList.toggle('side-open')});
var sel=$('#theme'); try{sel.value=localStorage.getItem('testreportium-theme')||'system'}catch(e){sel.value='system'}
sel.addEventListener('change',function(){
  var v=sel.value; if(v==='system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',v);
  try{localStorage.setItem('testreportium-theme',v)}catch(e){}
});
// Gallery reuses each screenshot's data URI instead of embedding it twice.
$$('.gitem img[data-from]').forEach(function(img){var s=$('#d-'+img.dataset.from+' .shot img'); if(s) img.src=s.src;});
var lb=$('#lb');
document.addEventListener('click',function(e){
  var img=e.target.closest&&e.target.closest('.shot img'); if(img){$('img',lb).src=img.src; lb.hidden=false; return;}
  if(e.target===lb||e.target.closest&&e.target.closest('#lb .iconbtn')) lb.hidden=true;
});
// Export: the results travel inside the page (#trdata), so this works offline.
var data=JSON.parse($('#trdata').textContent), exp=$('#exp'), menu=$('#expmenu');
function save(name,type,text){
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:type})); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href); a.remove();},500);
}
function csvCell(v){v=v==null?'':String(v); return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
exp.addEventListener('click',function(e){e.stopPropagation(); menu.hidden=!menu.hidden; exp.setAttribute('aria-expanded',String(!menu.hidden));});
document.addEventListener('click',function(){menu.hidden=true; exp.setAttribute('aria-expanded','false');});
$$('[data-exp]').forEach(function(b){b.addEventListener('click',function(){
  var base=(data.project||'report').replace(/[^\\w.-]+/g,'-')+'-'+new Date(data.summary.startTime).toISOString().slice(0,10);
  if(b.dataset.exp==='json') save(base+'.json','application/json',JSON.stringify(data,null,2));
  if(b.dataset.exp==='csv'){
    var cols=['title','group','file','status','duration','health','flakiness','newFailure','kind','diagnosis','error'];
    save(base+'.csv','text/csv',[cols.join(',')].concat(data.tests.map(function(t){return cols.map(function(c){return csvCell(t[c])}).join(',')})).join('\\n'));
  }
  if(b.dataset.exp==='print') window.print();
})});
$$('.rexp').forEach(function(b){b.addEventListener('click',function(){
  var row=document.getElementById(b.dataset.rd), open=row.hidden; row.hidden=!open; b.setAttribute('aria-expanded',String(open)); b.classList.toggle('open',open);
})});
// Closed <details> print as nothing: open the stack traces for the PDF, then restore.
var reopened=[];
window.addEventListener('beforeprint',function(){reopened=$$('details.sec.raw:not([open])');reopened.forEach(function(d){d.open=true});});
window.addEventListener('afterprint',function(){reopened.forEach(function(d){d.open=false});reopened=[];});
window.addEventListener('hashchange',route);
apply(); route();
})();`;
}
