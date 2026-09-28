/**
 * The Environment block must describe the device and app the run actually
 * used: read from the live session, never hardcoded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describeSession, recordSession, frameworkFromApp, frameworkFromFiles, renderReport } from '../dist/index.js';
import { readSessions, zipEntries } from '../dist/session.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'testreportium-'));

/** A minimal stored-entries zip, enough to exercise the central-directory reader. */
function makeZip(file, names) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(names.length, 8); eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
}

test('Android capabilities → human-readable rows', () => {
  const info = describeSession({
    platformName: 'Android', 'appium:platformVersion': '14', deviceName: 'emulator-5554',
    deviceManufacturer: 'Google', deviceModel: 'Pixel 7 Pro', appPackage: 'com.acme.shop',
    automationName: 'UiAutomator2', udid: 'emulator-5554',
  }, { serverVersion: '2.11.2' });
  assert.deepEqual(info, {
    Platform: 'Android 14', Device: 'Google Pixel 7 Pro', App: 'com.acme.shop',
    Automation: 'UiAutomator2', UDID: 'emulator-5554', Appium: '2.11.2',
  });
});

test('iOS capabilities, no model: falls back to deviceName', () => {
  const info = describeSession({ platformName: 'iOS', platformVersion: '17.4', deviceName: 'iPhone 15', bundleId: 'com.acme.shop', automationName: 'XCUITest' });
  assert.equal(info.Platform, 'iOS 17.4');
  assert.equal(info.Device, 'iPhone 15');
  assert.equal(info.App, 'com.acme.shop');
});

test('framework comes from the build’s own files', () => {
  assert.equal(frameworkFromFiles(['classes.dex', 'assets/index.android.bundle', 'lib/arm64-v8a/libhermesvm.so']), 'React Native');
  assert.equal(frameworkFromFiles(['classes.dex', 'lib/arm64-v8a/libflutter.so', 'assets/flutter_assets/AssetManifest.json']), 'Flutter');
  assert.equal(frameworkFromFiles(['Payload/Shop.app/Info.plist', 'Payload/Shop.app/Frameworks/Flutter.framework/Flutter']), 'Flutter');
  assert.equal(frameworkFromFiles(['Payload/Shop.app/Info.plist', 'Payload/Shop.app/main.jsbundle']), 'React Native');
  assert.equal(frameworkFromFiles(['classes.dex', 'lib/arm64-v8a/libmonodroid.so']), '.NET MAUI / Xamarin');
  assert.equal(frameworkFromFiles(['classes.dex', 'assets/public/index.html', 'assets/capacitor.config.json']), 'Capacitor / Cordova');
  assert.equal(frameworkFromFiles(['classes.dex', 'META-INF/androidx.compose.ui_ui.version']), 'Native (Jetpack Compose)');
  assert.equal(frameworkFromFiles(['classes.dex', 'res/layout/main.xml']), 'Native (Android)');
  assert.equal(frameworkFromFiles(['Payload/Shop.app/Info.plist']), 'Native (iOS)');
  assert.equal(frameworkFromFiles(['readme.txt']), undefined, 'no evidence → no claim');
});

test('reads an .apk’s file list from its central directory', () => {
  const apk = join(tmp(), 'app.apk');
  makeZip(apk, ['AndroidManifest.xml', 'classes.dex', 'lib/arm64-v8a/libflutter.so']);
  assert.deepEqual(zipEntries(apk), ['AndroidManifest.xml', 'classes.dex', 'lib/arm64-v8a/libflutter.so']);
  assert.equal(frameworkFromApp(apk), 'Flutter');
  assert.equal(describeSession({ platformName: 'Android', app: apk }).Framework, 'Flutter');
  assert.equal(describeSession({ platformName: 'Android', app: apk }).App, 'app.apk');
});

test('reads an unzipped iOS .app directory', () => {
  const app = join(tmp(), 'Shop.app');
  mkdirSync(join(app, 'Frameworks', 'React.framework'), { recursive: true });
  writeFileSync(join(app, 'Info.plist'), '');
  assert.equal(frameworkFromApp(app), 'React Native');
});

test('cloud app URLs and missing files make no claim', () => {
  assert.equal(frameworkFromApp('bs://c700ce60cf13ae8ed97705a55b8e022f13c5827c'), undefined);
  assert.equal(frameworkFromApp('/nope/app.apk'), undefined);
});

test('a WebView context is reported alongside the framework', () => {
  const apk = join(tmp(), 'app.apk');
  makeZip(apk, ['classes.dex']);
  assert.equal(describeSession({ platformName: 'Android', app: apk }, { webview: true }).Framework, 'Native (Android) + WebView');
  assert.equal(describeSession({ platformName: 'Android' }, { webview: true }).Framework, 'Hybrid (WebView)');
});

test('recordSession reads a live driver and never throws', async () => {
  const dir = tmp();
  const driver = {
    sessionId: 'abc',
    capabilities: { platformName: 'Android', platformVersion: '13', deviceModel: 'SM-S918B', deviceManufacturer: 'samsung', appPackage: 'com.acme', automationName: 'UiAutomator2' },
    getPageSource: async () => '<hierarchy><android.widget.FrameLayout class="com.facebook.react.ReactRootView"/></hierarchy>',
    getContexts: async () => ['NATIVE_APP'],
    status: async () => ({ build: { version: '2.5.0' } }),
  };
  const info = await recordSession(driver, { outputDirectory: dir });
  assert.equal(info.Device, 'samsung SM-S918B');
  assert.equal(info.Framework, 'React Native');
  assert.equal(await recordSession(driver, { outputDirectory: dir }), undefined, 'one line per session');
  assert.equal(readFileSync(join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n').length, 1);

  const broken = { sessionId: 'x', get capabilities() { throw new Error('boom'); } };
  assert.equal(await recordSession(broken, { outputDirectory: dir }), undefined);
});

test('a previous run’s session is never shown', () => {
  const dir = tmp();
  const now = Date.now();
  writeFileSync(join(dir, 'sessions.jsonl'), [
    JSON.stringify({ recordedAt: now - 86_400_000, Device: 'Old Phone' }),
    JSON.stringify({ recordedAt: now, Device: 'Pixel 8', Platform: 'Android 15' }),
    JSON.stringify({ recordedAt: now + 5, Device: 'iPhone 15', Platform: 'iOS 17.4' }),
  ].join('\n'));
  assert.deepEqual(readSessions(dir, now - 1000), { Device: 'Pixel 8 · iPhone 15', Platform: 'Android 15 · iOS 17.4' });
});

test('report: context option > live session > env vars, row by row', () => {
  const dir = tmp();
  const now = Date.now();
  writeFileSync(join(dir, 'sessions.jsonl'), JSON.stringify({ recordedAt: now, Platform: 'Android 14', Device: 'Pixel 7 Pro', App: 'com.acme' }));
  process.env.APPIUM_DEVICE_NAME = 'Env Phone';
  process.env.APPIUM_FRAMEWORK = 'rn';
  try {
    const run = { startTime: now, duration: 1, suites: [{ file: 'a', tests: [] }] };
    const html = renderReport(run, { outputDirectory: dir, context: { App: 'com.acme.override', Build: '4.2.0' } });
    const env = html.slice(html.indexOf('class="env"'));
    assert.match(env, /Device<\/span><b[^>]*>Pixel 7 Pro/, 'session beats env var');
    assert.match(env, /Framework<\/span><b[^>]*>rn/, 'env var fills a row the session lacks');
    assert.match(env, /App<\/span><b[^>]*>com\.acme\.override/, 'context beats session');
    assert.match(env, /Build<\/span><b[^>]*>4\.2\.0/, 'extra context rows are shown');
  } finally {
    delete process.env.APPIUM_DEVICE_NAME;
    delete process.env.APPIUM_FRAMEWORK;
  }
});

test('Environment block is always shown, with a how-to when nothing was recorded', () => {
  const html = renderReport({ startTime: Date.now(), duration: 1, suites: [{ file: 'a', tests: [] }] }, { outputDirectory: tmp(), historyFile: false });
  assert.match(html, /<div class="env">[\s\S]*No device or app recorded for this run[\s\S]*recordSession\(driver\)/);
});
