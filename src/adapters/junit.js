/**
 * JUnit XML adapter, the universal one. WebdriverIO (@wdio/junit-reporter),
 * Mocha (mocha-junit-reporter), Jest (jest-junit), pytest, TestNG and most
 * other runners can all write JUnit XML, so reading it covers them all.
 *
 * Zero dependencies: JUnit XML is flat and regular enough that a small
 * targeted parser is safer than pulling in an XML library.
 */

/** @typedef {import('../model.js').Run} Run */
/** @typedef {import('../model.js').Suite} Suite */
/** @typedef {import('../model.js').Test} Test */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode XML entities, and unwrap CDATA sections verbatim. */
function text(s = '') {
  return s.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map((part) =>
    part.startsWith('<![CDATA[')
      ? part.slice(9, -3)
      : part.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
        return ENT[e] ?? m;
      })).join('');
}

/** @returns {Record<string, string>} */
function attrs(s = '') {
  const out = {};
  for (const [, k, , v1, v2] of s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[k] = text(v1 ?? v2);
  return out;
}

/** JUnit writers disagree on time zones; a timestamp without one is UTC. */
function parseStamp(s) {
  if (!s) return undefined;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * @param {string} body Inner XML of one <testcase>.
 * @returns {{ status: Test['status'], errors: string[] }}
 */
function outcome(body = '') {
  const errors = [];
  for (const [, a, inner] of body.matchAll(/<(?:failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/g)) {
    const msg = attrs(a).message ?? '';
    const trace = text(inner ?? '').trim();
    // Most writers repeat the message as the trace's first line; do not show it twice.
    errors.push(trace && msg && trace.includes(msg) ? trace : [msg, trace].filter(Boolean).join('\n'));
  }
  if (errors.length) return { status: 'failed', errors };
  if (/<skipped\b/.test(body)) return { status: 'skipped', errors };
  return { status: 'passed', errors };
}

/**
 * Parse one or more JUnit XML documents into a single Run. Pass several when
 * the runner writes one file per worker or per spec (WebdriverIO does).
 *
 * @param {string | string[]} xml
 * @returns {Run}
 */
export function fromJUnit(xml) {
  /** @type {Suite[]} */
  const suites = [];
  const spans = [];
  let summed = 0;

  for (const doc of [xml].flat()) {
    for (const [, sa, body = ''] of doc.matchAll(/<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g)) {
      const s = attrs(sa);
      const secs = parseFloat(s.time);
      const start = parseStamp(s.timestamp);
      if (Number.isFinite(secs)) summed += secs * 1000;
      if (start !== undefined) spans.push([start, start + (Number.isFinite(secs) ? secs * 1000 : 0)]);

      /** @type {Test[]} */
      const tests = [];
      for (const [, ta, tb] of body.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
        const t = attrs(ta);
        let title = t.name ?? '';
        // classname is the describe path for Jest/Mocha; for WDIO it can be a
        // dotted spec id, still a sensible group label.
        let group = t.classname ? [t.classname] : [];
        // jest-junit by default writes "<describe> <title>" into BOTH
        // classname and name. Split it back on the suite name, or every test
        // becomes its own group and its title stops matching its screenshot.
        const full = t.classname && t.classname === title ? title : undefined;
        if (full) {
          const prefix = s.name ? `${s.name} ` : '';
          if (prefix && full.startsWith(prefix) && full.length > prefix.length) title = full.slice(prefix.length);
          group = s.name ? [s.name] : [];
        }
        const ms = parseFloat(t.time);
        tests.push({
          title,
          fullName: full ?? [...group, title].join(' '),
          group,
          ...outcome(tb),
          duration: Number.isFinite(ms) ? Math.round(ms * 1000) : undefined,
        });
      }

      // Runners that nest suites (mocha's "Root Suite") emit empty wrappers.
      const crash = /<(?:failure|error)\b/.test(body) && !tests.length ? outcome(body).errors.join('\n') : undefined;
      if (!tests.length && !crash) continue;
      suites.push({ file: s.file ?? s.name ?? 'unnamed suite', tests, error: crash });
    }
  }

  const startTime = spans.length ? Math.min(...spans.map(([a]) => a)) : Date.now();
  // Parallel workers overlap, so wall-clock is the span, not the sum.
  const duration = spans.length ? Math.max(...spans.map(([, b]) => b)) - startTime : Math.round(summed);
  return { startTime, duration, suites };
}
