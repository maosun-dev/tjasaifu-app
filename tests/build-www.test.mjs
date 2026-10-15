// www を作る仕組み（tools/build-www.mjs）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWww } from '../tools/build-www.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// 偽のリポジトリを一時フォルダに作る（node_modules と js は本物を指す）
function fakeRoot(html) {
  const root = mkdtempSync(join(tmpdir(), 'tjasaifu-app-'));
  mkdirSync(join(root, 'web/licenses'), { recursive: true });
  writeFileSync(join(root, 'web/tja-saifu.html'), html);
  writeFileSync(join(root, 'web/licenses/a_LICENSE.txt'), 'MIT');
  return root;
}
const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>x{}</style></head><body>${body}<script>var main=1;</script></body></html>`;

test('index.html に Capacitor の部品が本体より前に入る', () => {
  const root = fakeRoot(page('<script>var lib=1;</script>'));
  const out = join(root, 'www');
  buildWww({ root, out, repo });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const first = html.indexOf('<script>');
  for (const f of ['js/vendor/capacitor.js', 'js/vendor/synapse.js', 'js/vendor/filesystem.js', 'js/vendor/share.js', 'js/app-native.js']) {
    const at = html.indexOf(`<script src="${f}"></script>`);
    assert.ok(at >= 0, f + ' が入っていない');
    assert.ok(at < first, f + ' が本体より後ろ');
    assert.ok(existsSync(join(out, f)), f + ' のファイルが無い');
  }
});

test('ウェブ広告入りなら止まる', () => {
  const root = fakeRoot(page('<ins class="adsbygoogle"></ins>'));
  assert.throws(() => buildWww({ root, out: join(root, 'www'), repo }), /広告/);
});

test('外部の読み込みがあれば止まる', () => {
  const root = fakeRoot(page('<script src="https://example.com/a.js"></script>'));
  assert.throws(() => buildWww({ root, out: join(root, 'www'), repo }), /外部/);
});

test('licenses が写る', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo });
  assert.equal(readFileSync(join(out, 'licenses/a_LICENSE.txt'), 'utf8'), 'MIT');
});

test('Google Fonts は中に入れたフォントに替わる', () => {
  const links = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=A&display=swap">';
  const root = fakeRoot(page('').replace('<style>', links + '<style>'));
  mkdirSync(join(root, 'fonts'), { recursive: true });
  writeFileSync(join(root, 'fonts/fonts.css'), '@font-face{}');
  writeFileSync(join(root, 'fonts/A-400-001.woff2'), 'x');
  const out = join(root, 'www');
  buildWww({ root, out, repo });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.ok(!/fonts\.(googleapis|gstatic)/.test(html), 'Google Fonts が残っている');
  assert.ok(html.includes('<link rel="stylesheet" href="fonts/fonts.css">'));
  assert.ok(existsSync(join(out, 'fonts/A-400-001.woff2')));
});

test('ウェブ版の訪問者数（Tally）はアプリに入れない', () => {
  const counter = '<p class="credits" id="visitCount" hidden></p>' +
    `<script>(function(){var el=document.getElementById('visitCount');var u='https://tally.yuki.sh/hits/maosun-dev/tjasaifu.json';})();</script>\n`;
  const root = fakeRoot(page(counter));
  const out = join(root, 'www');
  buildWww({ root, out, repo });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.ok(!html.includes('tally.yuki.sh'));
  assert.ok(!html.includes('visitCount'));
  assert.ok(html.includes('var main=1;'), '本体まで消えている');
});

// ---- 広告・課金・「このアプリについて」用の足し物 ----
const SCRIPT_ORDER = [
  'js/vendor/capacitor.js', 'js/vendor/synapse.js', 'js/vendor/filesystem.js', 'js/vendor/share.js',
  'js/vendor/admob.js', 'js/vendor/preferences.js', 'js/vendor/purchases.js',
  'js/app-info.js', 'js/app-native.js', 'js/purchase.js', 'js/ads.js',
];

test('広告・課金の部品と app-info.js が決まった順で本体より前に入る', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const first = html.indexOf('<script>');
  let prev = -1;
  for (const f of SCRIPT_ORDER) {
    const at = html.indexOf(`<script src="${f}"></script>`);
    assert.ok(at >= 0, f + ' が入っていない');
    assert.ok(at > prev, f + ' の順番が違う');
    assert.ok(at < first, f + ' が本体より後ろ');
    assert.ok(existsSync(join(out, f)), f + ' のファイルが無い');
    prev = at;
  }
});

// app-info.js を window を持つ箱の中で動かして中身を取り出す
function runAppInfo(out) {
  const win = {};
  new Function('window', readFileSync(join(out, 'js/app-info.js'), 'utf8'))(win);
  return win;
}

test('ADS_CONFIG：production と purchases は既定で false', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: {} });
  assert.deepEqual(runAppInfo(out).ADS_CONFIG, { production: false, purchases: false });
});

test('ADS_PRODUCTION=1 で production が true、PURCHASES=1 で purchases が true（別々に効く）', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: { ADS_PRODUCTION: '1' } });
  assert.deepEqual(runAppInfo(out).ADS_CONFIG, { production: true, purchases: false });
  buildWww({ root, out, repo, env: { PURCHASES: '1' } });
  assert.deepEqual(runAppInfo(out).ADS_CONFIG, { production: false, purchases: true });
});

test('APP_INFO：版の番号は pbxproj の MARKETING_VERSION、部品は4つ', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: {} });
  const info = runAppInfo(out).APP_INFO;
  assert.equal(info.version, '1.0');
  assert.deepEqual(info.licenses.map(l => [l.name, l.license]), [
    ['Capacitor', 'MIT'],
    ['AdMob の部品', 'MIT'],
    ['課金の部品', 'MPL-2.0'],
    ['Dela Gothic One ほかフォント3つ', 'SIL Open Font License 1.1'],
  ]);
  for (const l of info.licenses) {
    assert.ok(existsSync(join(out, 'licenses', l.file)), l.file + ' が www/licenses/ に無い');
    assert.ok(readFileSync(join(out, 'licenses', l.file), 'utf8').length > 100, l.file + ' が空に近い');
  }
});

test('APP_INFO.licenses の写しは部品の本物の LICENSE と同じ', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: {} });
  const [cap, admob, purch, fonts] = runAppInfo(out).APP_INFO.licenses;
  const same = (l, src) => assert.equal(readFileSync(join(out, 'licenses', l.file), 'utf8'), readFileSync(join(repo, src), 'utf8'));
  same(cap, 'node_modules/@capacitor/core/LICENSE');
  same(admob, 'node_modules/@capacitor-community/admob/LICENSE');
  same(purch, 'node_modules/@capgo/native-purchases/LICENSE');
  same(fonts, 'fonts/LICENSE.txt');
});

test('本物の web/ を使うと、ツール自身の2つのライセンスも www/licenses/ に入る', () => {
  const out = mkdtempSync(join(tmpdir(), 'tjasaifu-www-'));
  buildWww({ root: repo, out: join(out, 'www'), repo, env: {} });
  for (const f of ['encoding-japanese_LICENSE.txt', 'wasm-media-encoders_LICENSE.txt']) {
    assert.ok(existsSync(join(out, 'www/licenses', f)), f + ' が無い');
  }
});
