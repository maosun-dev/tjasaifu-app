// ツールの完成品を tjasaifu から写す。写すのは dist/tja-saifu.html と app/licenses/ だけ
// （tjasaifu にある分析用の譜面などは、このリポジトリに入れない）。
// 使い方: npm run pull-web   （tjasaifu で node dist-build/build.js をしてから）
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.TJASAIFU_DIR || join(root, '..', 'tjasaifu');

mkdirSync(join(root, 'web'), { recursive: true });
copyFileSync(join(src, 'dist/tja-saifu.html'), join(root, 'web/tja-saifu.html'));
rmSync(join(root, 'web/licenses'), { recursive: true, force: true });
cpSync(join(src, 'app/licenses'), join(root, 'web/licenses'), { recursive: true });

let commit = '（不明）';
try { commit = execFileSync('git', ['-C', src, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim(); } catch (e) {}
writeFileSync(join(root, 'web/SOURCE.txt'),
  `写した日時: ${new Date().toISOString()}\n元: tjasaifu の dist/tja-saifu.html\ntjasaifu の最新コミット: ${commit}\n`);
console.log('web/ に写しました（' + commit + '）');
