// pull-web が TJA_APP=1 で組み立てを呼び、dist-app の完成品を写すことの試験（偽の tjasaifu を使う）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

test('pull-web は TJA_APP=1 で build を走らせ、dist-app/tja-saifu.html を web/ に写す', () => {
  const fake = mkdtempSync(join(tmpdir(), 'fake-tja-'));
  mkdirSync(join(fake, 'dist-build'), { recursive: true });
  mkdirSync(join(fake, 'app/licenses'), { recursive: true });
  writeFileSync(join(fake, 'app/licenses/a.txt'), 'lic');
  // 偽の build.js：環境変数を記録し、TJA_APP のときだけ dist-app に出す
  writeFileSync(join(fake, 'dist-build/build.js'), `
const fs=require('fs'),p=require('path');
fs.writeFileSync(p.join(__dirname,'..','env.txt'),String(process.env.TJA_APP));
const d=process.env.TJA_APP==='1'?'dist-app':'dist';
fs.mkdirSync(p.join(__dirname,'..',d),{recursive:true});
fs.writeFileSync(p.join(__dirname,'..',d,'tja-saifu.html'),'FROM-'+d);
`);
  const web = join(fake, 'web-out');
  execFileSync('node', [join(repo, 'tools/pull-web.mjs')], { env: { ...process.env, TJASAIFU_DIR: fake, WEB_DIR: web }, stdio: 'pipe' });
  assert.equal(readFileSync(join(fake, 'env.txt'), 'utf8'), '1');
  assert.equal(readFileSync(join(web, 'tja-saifu.html'), 'utf8'), 'FROM-dist-app');
  assert.match(readFileSync(join(web, 'SOURCE.txt'), 'utf8'), /dist-app/);
});
