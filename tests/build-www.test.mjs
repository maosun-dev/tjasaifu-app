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
