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
  ['admob.js', '@capacitor-community/admob/dist/plugin.js'],       // 広告
  ['preferences.js', '@capacitor/preferences/dist/plugin.js'],     // 小さな設定の保存
  ['purchases.js', '@capgo/native-purchases/dist/plugin.js'],      // 課金（広告を消す）
];

// 「このアプリについて」に出す部品のライセンス。file は www/licenses/ に写す名前、src は写し元
const LICENSES = [
  // 「Capacitor」の行の全文には、使っている Capacitor の部品すべての LICENSE を、部品の名前の見出しをつけて続けて入れる
  { name: 'Capacitor', license: 'MIT', file: 'capacitor_LICENSE.txt', src: 'node_modules/@capacitor/core/LICENSE', also: [
    ['@capacitor/filesystem', 'node_modules/@capacitor/filesystem/LICENSE'],
    ['@capacitor/share', 'node_modules/@capacitor/share/LICENSE'],
    ['@capacitor/preferences', 'node_modules/@capacitor/preferences/LICENSE'],
    ['@capacitor/synapse', 'node_modules/@capacitor/synapse/LICENSE.md'],
  ] },
  { name: 'AdMob の部品', license: 'MIT', file: 'capacitor-community-admob_LICENSE.txt', src: 'node_modules/@capacitor-community/admob/LICENSE' },
  { name: '課金の部品', license: 'MPL-2.0', file: 'capgo-native-purchases_LICENSE.txt', src: 'node_modules/@capgo/native-purchases/LICENSE' },
  { name: 'Dela Gothic One ほかフォント3つ', license: 'SIL Open Font License 1.1', file: 'fonts_OFL.txt', src: 'fonts/LICENSE.txt' },
];

// project.pbxproj の文字から版の番号（MARKETING_VERSION）を取り出す。無ければ null
export function marketingVersion(pbx) {
  return (pbx.match(/MARKETING_VERSION = ([^;\s]+);/) || [])[1] || null;
}

// root: web/ があるフォルダ、out: 書き出し先、repo: node_modules と js/ があるフォルダ
// env: ADS_PRODUCTION=1 で本物の広告、PURCHASES=1 で「広告を消す」の課金を有効にする（どちらも既定は off）
export function buildWww({ root = here, out = join(here, 'www'), repo = here, env = process.env } = {}) {
  // ストアに出す版（ADS_PRODUCTION=1）は、テストの広告 ID や空の ID のままでは組み立てない
  // Info.plist のアプリ ID は常に本物。AdMob の部品は、テスト用の広告ユニット ID を使えばアプリ ID が本物でもテスト広告を出す
  if (env.ADS_PRODUCTION === '1') {
    const ads = readFileSync(join(repo, 'js/ads.js'), 'utf8');
    if (!/const REAL_INTERSTITIAL = 'ca-app-pub-\d+\/\d+';/.test(ads)) {
      throw new Error('js/ads.js: 本物の全画面広告の ID（REAL_INTERSTITIAL）が空です');
    }
    if (/const REAL_INTERSTITIAL = 'ca-app-pub-3940256099942544\//.test(ads)) {
      throw new Error('js/ads.js: 本物の全画面広告の ID（REAL_INTERSTITIAL）が Google のテスト用の番号のままです');
    }
    const plist = readFileSync(join(repo, 'ios/App/App/Info.plist'), 'utf8');
    if (plist.includes('ca-app-pub-3940256099942544~') || !/<key>GADApplicationIdentifier<\/key>\s*<string>ca-app-pub-\d+~\d+<\/string>/.test(plist)) {
      throw new Error('ios/App/App/Info.plist: GADApplicationIdentifier が Google のテスト用のままです');
    }
  }
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

  // 部品のライセンスを写す（無ければ止める）
  mkdirSync(join(out, 'licenses'), { recursive: true });
  for (const l of LICENSES) {
    if (!existsSync(join(repo, l.src))) throw new Error(l.src + ' がありません。npm install と node tools/fetch-fonts.mjs を先に');
    if (!l.also) { copyFileSync(join(repo, l.src), join(out, 'licenses', l.file)); continue; }
    // 部品ごとの見出し + 全文を、空行をはさんで続ける（先頭は @capacitor/core）
    const parts = [['@capacitor/core', l.src], ...l.also];
    const text = parts.map(([n, src]) => {
      if (!existsSync(join(repo, src))) throw new Error(src + ' がありません。npm install を先に');
      return '===== ' + n + ' =====\n\n' + readFileSync(join(repo, src), 'utf8').trim() + '\n';
    }).join('\n');
    writeFileSync(join(out, 'licenses', l.file), text);
  }
  // 版の番号は Xcode の設定（MARKETING_VERSION）から読む
  const pbx = readFileSync(join(repo, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const version = marketingVersion(pbx);
  if (!version) throw new Error('project.pbxproj に MARKETING_VERSION がありません');
  const appInfo = { version, licenses: LICENSES.map(({ name, license, file }) => ({ name, license, file })) };
  const adsConfig = { production: env.ADS_PRODUCTION === '1', purchases: env.PURCHASES === '1' };
  writeFileSync(join(out, 'js/app-info.js'),
    `window.APP_INFO = ${JSON.stringify(appInfo)};
window.ADS_CONFIG = ${JSON.stringify(adsConfig)};
`);
  for (const f of ['purchase.js', 'ads.js']) copyFileSync(join(repo, 'js', f), join(out, 'js', f));

  const tags = [...VENDOR.map(([f]) => `js/vendor/${f}`), 'js/app-info.js', 'js/app-native.js', 'js/purchase.js', 'js/ads.js']
    .map(f => `<script src="${f}"></script>`).join('\n');
  html = html.replace('</head>', tags + '\n</head>');
  writeFileSync(join(out, 'index.html'), html);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildWww();
  console.log('www/index.html を作りました（広告: ' + (process.env.ADS_PRODUCTION === '1' ? '本物' : 'テスト') + '、課金: ' + (process.env.PURCHASES === '1' ? 'あり' : 'なし') + '）');
}
