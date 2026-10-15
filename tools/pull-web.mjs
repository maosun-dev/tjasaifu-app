// ツールの完成品を tjasaifu から写す。写すのは dist-app/tja-saifu.html（広告なしのアプリ用）と app/licenses/ だけ
// （tjasaifu にある分析用の譜面などは、このリポジトリに入れない）。
// 使い方: npm run pull-web   （tjasaifu で TJA_APP=1 の組み立てを自分で走らせてから写す）
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.TJASAIFU_DIR || join(root, '..', 'tjasaifu');

const web = process.env.WEB_DIR || join(root, 'web');   // 試験では別の場所にする
mkdirSync(web, { recursive: true });
// アプリ用は広告（AdSense）なしで組み立てる。TJA_APP=1 を付けるのを忘れないよう、ここで走らせる
execFileSync('node', [join(src, 'dist-build/build.js')], { cwd: src, env: { ...process.env, TJA_APP: '1' }, stdio: 'inherit' });
copyFileSync(join(src, 'dist-app/tja-saifu.html'), join(web, 'tja-saifu.html'));
rmSync(join(web, 'licenses'), { recursive: true, force: true });
cpSync(join(src, 'app/licenses'), join(web, 'licenses'), { recursive: true });

let commit = '（不明）';
try { commit = execFileSync('git', ['-C', src, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim(); } catch (e) {}
writeFileSync(join(web, 'SOURCE.txt'),
  `写した日時: ${new Date().toISOString()}\n元: tjasaifu の dist-app/tja-saifu.html\ntjasaifu の最新コミット: ${commit}\n`);
console.log('web/ に写しました（' + commit + '）');
