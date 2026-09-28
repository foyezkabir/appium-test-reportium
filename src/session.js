/**
 * session.js: record what the run ACTUALLY ran on, from the live session.
 *
 * The report's Environment block must describe the real device and app, not
 * whatever an env var or config file claims. So we ask the Appium session:
 * its returned capabilities say the platform, OS version, device, app and
 * automation driver. The UI framework comes from the app build's own files
 * when it is on this machine, else from driver and hierarchy markers.
 *
 * Each session appends one line to <outputDirectory>/sessions.jsonl. The
 * renderer reads the lines recorded during the run and shows them.
 */

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOutputDirectory } from './paths.js';

/**
 * @typedef {object} SessionDriver WebdriverIO browser / Appium client.
 * @property {Record<string, any>} [capabilities] Capabilities the server returned.
 * @property {string} [sessionId]
 * @property {() => Promise<string>} [getPageSource]
 * @property {() => Promise<any[]>} [getContexts]
 * @property {() => Promise<any>} [status]
 */

/**
 * @typedef {object} SessionInfo
 * @property {string} [Platform] e.g. 'Android 14', 'iOS 17.4'
 * @property {string} [Device] e.g. 'Google Pixel 7 Pro', 'iPhone 15'
 * @property {string} [Framework] e.g. 'React Native', 'Flutter', 'Native'
 * @property {string} [App] package or bundle id
 * @property {string} [Automation] e.g. 'UiAutomator2', 'XCUITest'
 * @property {string} [UDID]
 * @property {string} [Appium] server version
 */

/** Read a capability whether or not the server kept the 'appium:' prefix. */
const cap = (caps, k) => caps[k] ?? caps[`appium:${k}`];

/**
 * List the file names inside a zip (.apk, .ipa) by reading only its central
 * directory at the end of the file, so a 200 MB APK costs a few KB of reads.
 *
 * @param {string} file
 * @returns {string[]}
 */
export function zipEntries(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 66_000); // EOCD is within the last 64 KB + 22 bytes
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return [];
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const names = [];
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const n = cd.readUInt16LE(p + 28), x = cd.readUInt16LE(p + 30), c = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + n));
      p += 46 + n + x + c;
    }
    return names;
  } finally {
    closeSync(fd);
  }
}

/** Every file path under a directory (an unzipped iOS .app bundle). */
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    out.push(full.slice(base.length + 1) + (e.isDirectory() ? '/' : ''));
    if (e.isDirectory() && out.length < 20_000) walk(full, base, out);
  }
  return out;
}

/**
 * Identify the framework from the files a build contains. Each marker is a
 * file the framework's own toolchain puts there, so a match is evidence.
 *
 * @param {string[]} names Paths inside the .apk / .ipa / .app.
 * @returns {string | undefined}
 */
export function frameworkFromFiles(names) {
  const has = (re) => names.some((n) => re.test(n));
  if (has(/(^|\/)libflutter\.so$|Flutter\.framework\/|(^|\/)flutter_assets\//)) return 'Flutter';
  if (has(/index\.android\.bundle$|main\.jsbundle$|libreactnativejni\.so$|React\.framework\/|React-Core|hermes\.framework\//)) return 'React Native';
  if (has(/libmonodroid\.so$|(^|\/)assemblies\/|\.dll$|Xamarin\./)) return '.NET MAUI / Xamarin';
  if (has(/libunity\.so$|UnityFramework\.framework\//)) return 'Unity';
  if (has(/libNativeScript\.so$|NativeScript\.framework\//)) return 'NativeScript';
  if (has(/capacitor\.config\.json$|(^|\/)cordova\.js$|capacitor\.js$/)) return 'Capacitor / Cordova';
  if (has(/META-INF\/androidx\.compose\./)) return 'Native (Jetpack Compose)';
  if (has(/^classes\d*\.dex$/)) return 'Native (Android)';
  if (has(/(^|\/)Info\.plist$/)) return 'Native (iOS)';
  return undefined;
}

/**
 * Framework from the app under test, if its build is on this machine.
 * Cloud URLs (bs://, sl://, https://) are skipped; nothing local to read.
 *
 * @param {string | undefined} app The 'app' capability.
 * @returns {string | undefined}
 */
export function frameworkFromApp(app) {
  if (!app || /^[a-z]+:\/\//i.test(app) || !existsSync(app)) return undefined;
  try {
    return frameworkFromFiles(statSync(app).isDirectory() ? walk(app) : zipEntries(app));
  } catch {
    return undefined; // unreadable build: say nothing rather than guess
  }
}

/**
 * Framework markers that do show up in a live view hierarchy on some
 * drivers. Absence proves nothing, so no match returns undefined.
 *
 * @param {string} xml
 * @returns {string | undefined}
 */
export function frameworkFromPageSource(xml = '') {
  if (/io\.flutter|FlutterView|flutter_semantics/i.test(xml)) return 'Flutter';
  if (/com\.facebook\.react|ReactViewGroup|ReactTextView|RCTView/.test(xml)) return 'React Native';
  if (/androidx\.compose|ComposeView/.test(xml)) return 'Native (Jetpack Compose)';
  return undefined;
}

/**
 * Pure: capabilities (+ optional page source / server status) → SessionInfo.
 *
 * @param {Record<string, any>} caps
 * @param {{ pageSource?: string, serverVersion?: string, webview?: boolean }} [extra]
 * @returns {SessionInfo}
 */
export function describeSession(caps = {}, extra = {}) {
  const platform = String(cap(caps, 'platformName') ?? '').trim();
  const isAndroid = /android/i.test(platform);
  const version = cap(caps, 'platformVersion');
  const osName = isAndroid ? 'Android' : /ios/i.test(platform) ? 'iOS' : platform;

  // Android returns the adb serial as deviceName ('emulator-5554'); the model
  // and manufacturer are the human-readable truth when present.
  const model = cap(caps, 'deviceModel');
  const maker = cap(caps, 'deviceManufacturer');
  const device = model
    ? [maker && !String(model).toLowerCase().startsWith(String(maker).toLowerCase()) ? maker : '', model].filter(Boolean).join(' ')
    : cap(caps, 'deviceName');

  const app = cap(caps, 'appPackage') ?? cap(caps, 'bundleId')
    ?? (cap(caps, 'app') ? String(cap(caps, 'app')).split(/[\\/]/).pop() : undefined)
    ?? (cap(caps, 'browserName') ? `browser: ${cap(caps, 'browserName')}` : undefined);

  const automation = cap(caps, 'automationName');
  // Evidence, strongest first: the build's own files, then the driver, then
  // the live hierarchy. Nothing conclusive → the row is left out.
  let framework = frameworkFromApp(cap(caps, 'app'))
    ?? (/flutter/i.test(automation ?? '') ? 'Flutter' : undefined)
    ?? frameworkFromPageSource(extra.pageSource);
  if (extra.webview && framework && !/WebView|Capacitor|Cordova/.test(framework)) framework += ' + WebView';
  if (extra.webview && !framework) framework = 'Hybrid (WebView)';
  /** @type {SessionInfo} */
  const info = {
    Platform: [osName, version].filter(Boolean).join(' ') || undefined,
    Device: device ? String(device) : undefined,
    Framework: framework,
    App: app ? String(app) : undefined,
    Automation: automation ? String(automation) : undefined,
    UDID: cap(caps, 'udid') ? String(cap(caps, 'udid')) : undefined,
    Appium: extra.serverVersion,
  };
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v));
}

const recorded = new Set();

/**
 * Record the live session. Call once right after the session starts (for
 * example in WebdriverIO's `before` hook). Never throws: a missing detail
 * leaves that row out, it must never fail a test.
 *
 * @param {SessionDriver} driver
 * @param {{ outputDirectory?: string, detectFramework?: boolean }} [options]
 * @returns {Promise<SessionInfo | undefined>}
 */
export async function recordSession(driver, options = {}) {
  try {
    const key = driver?.sessionId ?? 'session';
    if (recorded.has(key)) return undefined;
    recorded.add(key);

    let pageSource;
    if (options.detectFramework !== false && typeof driver.getPageSource === 'function') {
      try { pageSource = await driver.getPageSource(); } catch { /* no screen yet, framework stays unknown */ }
    }
    let webview = false;
    if (typeof driver.getContexts === 'function') {
      try { webview = (await driver.getContexts()).some((c) => /WEBVIEW/i.test(typeof c === 'string' ? c : c?.id ?? '')); } catch { /* driver without contexts */ }
    }
    let serverVersion;
    if (typeof driver.status === 'function') {
      try { serverVersion = (await driver.status())?.build?.version; } catch { /* older servers */ }
    }

    const info = describeSession(driver.capabilities ?? {}, { pageSource, serverVersion, webview });
    const dir = options.outputDirectory ?? defaultOutputDirectory();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'sessions.jsonl'), `${JSON.stringify({ recordedAt: Date.now(), ...info })}\n`);
    return info;
  } catch (e) {
    console.warn(`[testreportium] session not recorded: ${e.message}`);
    return undefined;
  }
}

/**
 * Sessions recorded during this run, as one label → value map. Lines older
 * than the run (a previous run's leftovers) are ignored, so a stale file can
 * never put the wrong device in the report. Several devices are joined.
 *
 * @param {string} dir
 * @param {number} runStart Epoch ms.
 * @returns {Record<string, string>}
 */
export function readSessions(dir, runStart) {
  const f = join(dir, 'sessions.jsonl');
  if (!existsSync(f)) return {};
  const rows = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      // Sessions are often created a little before the runner stamps its start.
      if (!Number.isFinite(runStart) || !r.recordedAt || r.recordedAt >= runStart - 5 * 60_000) rows.push(r);
    } catch { /* a truncated line must not lose the rest */ }
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k === 'recordedAt' || !v) continue;
      const seen = out[k] ? out[k].split(' · ') : [];
      if (!seen.includes(String(v))) out[k] = [...seen, String(v)].join(' · ');
    }
  }
  return out;
}
