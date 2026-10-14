// ツールが使う Google Fonts を取ってきて、アプリの中に入れる（電波が無くても同じ見た目になるように）。
//   -> fonts/*.woff2 + fonts/fonts.css
// どのフォントを取るかは web/tja-saifu.html の Google Fonts の行から読む。
// 日本語のフォントは Google が細かく分けているが、全部取っておく（画面に出た分だけ読まれる）。
// ツールのフォントが変わったときだけやり直す。
// 使い方: node tools/fetch-fonts.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'web/tja-saifu.html'), 'utf8');
const m = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/);
if (!m) throw new Error('web/tja-saifu.html に Google Fonts の行がありません');
const CSS_URL = m[1].replace(/&amp;/g, '&');
// 新しいブラウザのふりをして、woff2 で受け取る
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const dir = join(root, 'fonts');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
if (!faces.length) throw new Error('Google Fonts の答えに @font-face がありません');

const out = [], counts = {};
let bytes = 0;
for (const face of faces) {
  const family = face.match(/font-family:\s*'([^']+)'/)[1];
  const weight = face.match(/font-weight:\s*(\d+)/)[1];
  const url = face.match(/url\((https:[^)]+\.woff2)\)/)[1];
  const key = `${family}-${weight}`;
  const n = counts[key] = (counts[key] || 0) + 1;
  const file = `${family.replace(/\s+/g, '')}-${weight}-${String(n).padStart(3, '0')}.woff2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(join(dir, file), buf);
  bytes += buf.length;
  out.push(face.replace(url, file));
}
writeFileSync(join(dir, 'fonts.css'), `/* tools/fetch-fonts.mjs で作った。手で直さない */\n${out.join('\n')}\n`);
writeFileSync(join(dir, 'LICENSE.txt'),
  'このフォルダのフォントは SIL Open Font License 1.1 で配られています（https://openfontlicense.org/）。\n' +
  Object.keys(counts).map(k => k.replace(/-\d+$/, '')).filter((v, i, a) => a.indexOf(v) === i).map(f => '- ' + f).join('\n') + '\n');
console.log(`${out.length} 個のフォントファイル、${(bytes / 1024 / 1024).toFixed(1)} MB`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${k}: ${n}`);
