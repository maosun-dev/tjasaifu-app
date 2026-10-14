// iPhone アプリ（Capacitor）用の www/ を、web/tja-saifu.html（ツールの完成品の写し）から作る。
// ツール本体は変えない。</head> の前に、Capacitor の部品と保存の差し替え（js/app-native.js）を足すだけ。
// 使い方: npm run build
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

// Capacitor の部品（ブラウザ側）。読み込む順番どおりに並べる
const VENDOR = [
  ['capacitor.js', '@capacitor/core/dist/capacitor.js'],
  ['synapse.js', null],   // Filesystem の手伝い役（下で作る）
  ['filesystem.js', '@capacitor/filesystem/dist/plugin.js'],
  ['share.js', '@capacitor/share/dist/plugin.js'],
];

// root: web/ があるフォルダ、out: 書き出し先、repo: node_modules と js/ があるフォルダ
export function buildWww({ root = here, out = join(here, 'www'), repo = here } = {}) {
  let html = readFileSync(join(root, 'web/tja-saifu.html'), 'utf8');

  // アプリにウェブ用の広告（AdSense）を入れない。広告入りの完成品を写してしまったときに気づけるように止める
  if (/adsbygoogle|pagead2\.googlesyndication/.test(html)) {
    throw new Error('web/tja-saifu.html にウェブ用の広告が入っています。広告なしの完成品を写してください');
  }
  // フォント：Google Fonts の読み込みを、中に入れたフォント（fonts/、tools/fetch-fonts.mjs で作る）に替える
  const gf = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/;
  if (gf.test(html)) {
    if (!existsSync(join(root, 'fonts/fonts.css'))) throw new Error('fonts/fonts.css がありません。node tools/fetch-fonts.mjs を先に');
    html = html.replace(gf, '<link rel="stylesheet" href="fonts/fonts.css">');
  }
  // ウェブ版の訪問者数（Tally）はアプリでは数えない（アプリを開くたびに外へ送ってしまうため）
  html = html.replace('<p class="credits" id="visitCount" hidden></p>', '')
    .replace(/<script>\(function\(\)\{var el=document\.getElementById\('visitCount'\)[\s\S]*?<\/script>\n?/, '');
  if (/tally\.yuki\.sh|visitCount/.test(html)) throw new Error('訪問者数の仕組みを外せませんでした');
  // 外部の読み込みに頼らない（オフラインでも動くように）
  if (/<(script|link)[^>]+(src|href)="https?:\/\//i.test(html)) {
    throw new Error('web/tja-saifu.html に外部の読み込みがあります');
  }
  if (html.split('</head>').length !== 2) throw new Error('web/tja-saifu.html の </head> が1か所ではありません');

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'js/vendor'), { recursive: true });
  for (const [to, from] of VENDOR) {
    if (from) copyFileSync(join(repo, 'node_modules', from), join(out, 'js/vendor', to));
  }
  // Filesystem の部品は手伝い役を "synapse" という名前で探す
  writeFileSync(join(out, 'js/vendor/synapse.js'),
    readFileSync(join(repo, 'node_modules/@capacitor/synapse/dist/synapse.js'), 'utf8') + '\nwindow.synapse = window.outsystemsSynapse;\n');
  if (existsSync(join(root, 'fonts'))) cpSync(join(root, 'fonts'), join(out, 'fonts'), { recursive: true });
  copyFileSync(join(repo, 'js/app-native.js'), join(out, 'js/app-native.js'));
  if (existsSync(join(root, 'web/licenses'))) cpSync(join(root, 'web/licenses'), join(out, 'licenses'), { recursive: true });

  const tags = [...VENDOR.map(([f]) => `js/vendor/${f}`), 'js/app-native.js']
    .map(f => `<script src="${f}"></script>`).join('\n');
  html = html.replace('</head>', tags + '\n</head>');
  writeFileSync(join(out, 'index.html'), html);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildWww();
  console.log('www/index.html を作りました');
}
