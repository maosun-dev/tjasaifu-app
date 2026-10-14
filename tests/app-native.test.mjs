// 保存の差し替え（js/app-native.js）のテスト。iPhone の部品は偽物を用意して、vm の中で読み込む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js/app-native.js'), 'utf8');

function load({ native = true, shareError = null } = {}) {
  const calls = [];
  const Filesystem = {
    async writeFile(o) { calls.push(['write', o]); return { uri: 'file:///cache/' + o.path }; },
    async appendFile(o) { calls.push(['append', o]); },
    async getUri(o) { return { uri: 'file:///cache/' + o.path }; },
  };
  const Share = { async share(o) { calls.push(['share', o]); if (shareError) throw shareError; } };
  const window = {
    Capacitor: { isNativePlatform: () => native },
    capacitorFilesystemPluginCapacitor: { Filesystem, Directory: { Cache: 'CACHE' } },
    capacitorShare: { Share },
  };
  vm.runInNewContext(code, { window, Blob, Uint8Array, ArrayBuffer, TextEncoder, btoa, Error, Object, Promise, String, Math });
  return { window, calls };
}
// 書かれた base64 をつないで、元のバイトに戻す
const written = calls => Buffer.concat(calls.filter(c => c[0] !== 'share').map(c => Buffer.from(c[1].data, 'base64')));

test('ブラウザでは何もしない', () => {
  assert.equal(load({ native: false }).window.claude, undefined);
});

test('browser が true（TJA の名前に .txt が付かないように）', async () => {
  assert.equal((await load().window.claude.use('downloads')).browser, true);
});

test('文字の TJA を保存できる', async () => {
  const { window, calls } = load();
  await (await window.claude.use('downloads')).save({ filename: 'a.tja', data: '#START\nあ' });
  assert.equal(written(calls).toString('utf8'), '#START\nあ');
  const share = calls.find(c => c[0] === 'share')[1];
  assert.deepEqual([...share.files], ['file:///cache/a.tja']);
  assert.equal(calls[0][1].directory, 'CACHE');
});

test('Blob の zip も保存できる', async () => {
  const { window, calls } = load();
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
  await (await window.claude.use('downloads')).save({ filename: 'b.zip', data: new Blob([bytes]) });
  assert.deepEqual([...written(calls)], [...bytes]);
});

test('大きい zip は 3MB ずつ書く', async () => {
  const { window, calls } = load();
  const big = new Uint8Array(7 * 1024 * 1024).map((_, i) => i * 7 % 256);
  await (await window.claude.use('downloads')).save({ filename: 'c.zip', data: big });
  assert.equal(calls.filter(c => c[0] === 'write').length, 1);
  assert.equal(calls.filter(c => c[0] === 'append').length, 2);
  assert.ok(Buffer.from(big).equals(written(calls)));
});

test('キャンセルは declined', async () => {
  const { window } = load({ shareError: new Error('Share canceled') });
  const d = await window.claude.use('downloads');
  await assert.rejects(d.save({ filename: 'a.tja', data: 'x' }), e => e.code === 'declined');
});

test('ほかの名前は null', async () => {
  assert.equal(await load().window.claude.use('db'), null);
});
