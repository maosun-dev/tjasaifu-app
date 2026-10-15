// www を作る仕組み（tools/build-www.mjs）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync } from 'node:fs';
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
  'js/vendor/network.js', 'js/vendor/file-picker.js',
  'js/app-info.js', 'js/app-native.js', 'js/purchase.js', 'js/ads.js', 'js/app-flow.js',
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
  // Capacitor の行は、core の全文に続けて他の部品の全文も入る（別の試験で確かめる）
  assert.ok(readFileSync(join(out, 'licenses', cap.file), 'utf8').includes(readFileSync(join(repo, 'node_modules/@capacitor/core/LICENSE'), 'utf8').trim()));
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

test('MARKETING_VERSION の読み取り：s を含む番号も読め、空白は含めない', async () => {
  const { marketingVersion } = await import('../tools/build-www.mjs');
  assert.equal(marketingVersion('MARKETING_VERSION = 1.0;'), '1.0');
  assert.equal(marketingVersion('\t\tMARKETING_VERSION = 2.1s;\n'), '2.1s');
  assert.equal(marketingVersion('MARKETING_VERSION = ;'), null);
});

// ---- 守り：ストア向け（ADS_PRODUCTION=1）の組み立ては、テストの ID が残っていたら止まる ----
// 偽の repo（js・ios の必要な分だけ写し、node_modules と fonts は本物を指す）を作る
function fakeRepo({ plist, ads } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'tjasaifu-repo-'));
  cpSync(join(repo, 'js'), join(r, 'js'), { recursive: true });
  mkdirSync(join(r, 'ios/App/App.xcodeproj'), { recursive: true });
  cpSync(join(repo, 'ios/App/App.xcodeproj/project.pbxproj'), join(r, 'ios/App/App.xcodeproj/project.pbxproj'));
  cpSync(join(repo, 'ios/App/App/Info.plist'), join(r, 'ios/App/App/Info.plist'), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(r, 'node_modules'), 'junction');
  symlinkSync(join(repo, 'fonts'), join(r, 'fonts'), 'junction');
  if (plist) writeFileSync(join(r, 'ios/App/App/Info.plist'), plist(readFileSync(join(r, 'ios/App/App/Info.plist'), 'utf8')));
  if (ads) writeFileSync(join(r, 'js/ads.js'), ads(readFileSync(join(r, 'js/ads.js'), 'utf8')));
  return r;
}
const TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

test('ADS_PRODUCTION=1：Info.plist も ads.js も本物なら組み立てられる', () => {
  const r = fakeRepo();
  const root = fakeRoot(page(''));
  buildWww({ root, out: join(root, 'www'), repo: r, env: { ADS_PRODUCTION: '1' } });
  assert.ok(existsSync(join(root, 'www/index.html')));
});

test('ADS_PRODUCTION=1：Info.plist がテストのアプリ ID なら止まる', () => {
  const r = fakeRepo({ plist: p => p.replace(/ca-app-pub-7017663942238206~\d+/, TEST_APP_ID) });
  const root = fakeRoot(page(''));
  assert.throws(() => buildWww({ root, out: join(root, 'www'), repo: r, env: { ADS_PRODUCTION: '1' } }), /GADApplicationIdentifier/);
});

test('ADS_PRODUCTION=1：ads.js の本物の全画面 ID が空なら止まる', () => {
  const r = fakeRepo({ ads: a => a.replace(/const REAL_INTERSTITIAL = '[^']*';/, "const REAL_INTERSTITIAL = '';") });
  const root = fakeRoot(page(''));
  assert.throws(() => buildWww({ root, out: join(root, 'www'), repo: r, env: { ADS_PRODUCTION: '1' } }), /REAL_INTERSTITIAL/);
});

test('ADS_PRODUCTION=1：ads.js の本物の全画面 ID が Google のテスト番号なら止まる', () => {
  const r = fakeRepo({ ads: a => a.replace(/const REAL_INTERSTITIAL = '[^']*';/, "const REAL_INTERSTITIAL = 'ca-app-pub-3940256099942544/4411468910';") });
  const root = fakeRoot(page(''));
  assert.throws(() => buildWww({ root, out: join(root, 'www'), repo: r, env: { ADS_PRODUCTION: '1' } }), /テスト/);
});

test('既定（ADS_PRODUCTION なし）の組み立ては、守りに引っかからずテスト ID のまま動く', () => {
  const r = fakeRepo({
    plist: p => p.replace(/ca-app-pub-7017663942238206~\d+/, TEST_APP_ID),
    ads: a => a.replace(/const REAL_INTERSTITIAL = '[^']*';/, "const REAL_INTERSTITIAL = '';"),
  });
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo: r, env: {} });
  assert.deepEqual(runAppInfo(out).ADS_CONFIG, { production: false, purchases: false });
});

test('ads.js：テストの全画面 ID と本物の ID がどちらも入っている', () => {
  const a = readFileSync(join(repo, 'js/ads.js'), 'utf8');
  assert.match(a, /const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544\/4411468910';/);
  assert.match(a, /const REAL_INTERSTITIAL = 'ca-app-pub-7017663942238206\/6960467426';/);
});

test('Capacitor の行の全文ファイルに、7つの部品の名前と LICENSE が入っている（表示の行は4つのまま）', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: {} });
  const info = runAppInfo(out).APP_INFO;
  assert.equal(info.licenses.length, 4);
  assert.equal(info.licenses[0].name, 'Capacitor');
  const txt = readFileSync(join(out, 'licenses', info.licenses[0].file), 'utf8');
  for (const n of ['@capacitor/core', '@capacitor/filesystem', '@capacitor/share', '@capacitor/preferences', '@capacitor/synapse', '@capacitor/network', '@capawesome/capacitor-file-picker']) {
    assert.ok(txt.includes(n), n + ' が全文ファイルに無い');
  }
  assert.ok(txt.includes(readFileSync(join(repo, 'node_modules/@capacitor/synapse/LICENSE.md'), 'utf8').trim()), 'synapse の全文が無い');
  assert.ok(txt.includes(readFileSync(join(repo, 'node_modules/@capacitor/filesystem/LICENSE'), 'utf8').trim()), 'filesystem の全文が無い');
  assert.ok(txt.includes(readFileSync(join(repo, 'node_modules/@capacitor/network/LICENSE'), 'utf8').trim()), 'network の全文が無い');
  assert.ok(txt.includes(readFileSync(join(repo, 'node_modules/@capawesome/capacitor-file-picker/LICENSE'), 'utf8').trim()), 'file-picker の全文が無い');
});

test('ファイル選び・つながりの部品の配布ファイルは、決まったグローバル名を作る', () => {
  const root = fakeRoot(page(''));
  const out = join(root, 'www');
  buildWww({ root, out, repo, env: {} });
  assert.match(readFileSync(join(out, 'js/vendor/network.js'), 'utf8'), /^var capacitorNetwork = /);
  assert.match(readFileSync(join(out, 'js/vendor/file-picker.js'), 'utf8'), /^var capacitorFilePicker = /);
  assert.ok(existsSync(join(out, 'js/app-flow.js')));
});
