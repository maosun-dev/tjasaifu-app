// 曲・ファイルを選ぶ流れ（js/app-flow.js の window.TjaApp）のテスト。
// iPhone の部品（ファイル選び・つながり・AdMob・課金・小さな保存）は偽物を用意して、vm の中で読み込む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// 選ばれたファイル（本体のファイル選びが返す形）
const PICKED = { name: 'うた.ogg', path: 'file:///tmp/うた.ogg', mimeType: 'audio/ogg', size: 3 };

function fakePicker({ result = { files: [PICKED] }, error = null } = {}) {
  const calls = [];
  return {
    calls,
    async pickFiles(o) { calls.push(o); if (error) throw error; return result; },
  };
}
function fakeNetwork(connected = true, over = {}) {
  const calls = [];
  return { calls, async getStatus() { calls.push('getStatus'); return { connected, connectionType: connected ? 'wifi' : 'none' }; }, ...over };
}
function fakeAdMob(log) {
  const a = {
    handlers: {},
    trackingAuthorizationStatus: async () => ({ status: 'authorized' }),
    requestTrackingAuthorization: async () => ({}),
    initialize: async () => ({}),
    addListener(n, f) { a.handlers[n] = f; return Promise.resolve({ remove() {} }); },
    prepareInterstitial: async () => ({}),
    showInterstitial: async () => { log.push('showInterstitial'); return {}; },
  };
  return a;
}
function fakePrefs(initial = {}) {
  const store = { ...initial };
  return {
    get: async ({ key }) => ({ value: key in store ? store[key] : null }),
    set: async ({ key, value }) => { store[key] = value; },
    remove: async ({ key }) => { delete store[key]; },
  };
}
function fakeStore(owned = false) {
  return {
    getPurchases: async () => ({ purchases: owned ? [{ productIdentifier: 'com.maosundev.tjasaifu.removeads' }] : [] }),
    purchaseProduct: async () => ({}), restorePurchases: async () => {},
    getProduct: async () => ({ product: { priceString: '¥600' } }),
    addListener: async () => ({ remove() {} }),
  };
}

// files: 読み込むスクリプト。window に足すもの（TjaAds・Purchase の偽物など）は extra で
function load(files, {
  native = true, picker = fakePicker(), network = fakeNetwork(), withPicker = true, withNetwork = true,
  fetchImpl = null, extra = {}, purchases = true, owned = false, log = [],
} = {}) {
  const fetched = [];
  const admob = fakeAdMob(log);
  const window = {
    console, Promise, File, Blob, log,
    document: { body: { classList: { contains: () => false } }, getElementById: () => null },
    setTimeout: (f, ms) => setTimeout(f, ms === 10000 ? 300 : Math.min(ms, 20)), clearTimeout,
    addEventListener() {},
    fetch: fetchImpl || (async url => { fetched.push(url); return { ok: true, blob: async () => new Blob(['abc'], { type: '' }) }; }),
    ...extra,
  };
  if (native) {
    window.Capacitor = { isNativePlatform: () => true, convertFileSrc: p => 'capacitor://localhost/_capacitor_file_' + p.replace(/^file:\/\//, '') };
    if (withPicker) window.capacitorFilePicker = { FilePicker: { pickFiles: o => { log.push('pickFiles'); return picker.pickFiles(o); } } };
    if (withNetwork) window.capacitorNetwork = { Network: network };
    window.capacitorStripe = { AdMob: admob };
    window.capacitorPreferences = { Preferences: fakePrefs(owned ? { 'tjasaifu-noads': '1' } : {}) };
    window.capacitorNativePurchases = { NativePurchases: fakeStore(owned) };
    window.ADS_CONFIG = { production: false, purchases };
  }
  window.window = window;
  const ctx = vm.createContext(window);
  for (const f of files) vm.runInContext(readFileSync(join(repo, f), 'utf8'), ctx, { filename: f });
  return { w: window, picker, network, admob, fetched, log };
}
const flow = ['js/app-flow.js'];
const all = ['js/purchase.js', 'js/ads.js', 'js/app-flow.js'];
const noAd = { TjaAds: { showNow: async () => false } };

/* ---------- 作るかどうか ---------- */

test('ウェブ版（iPhone でない）では TjaApp を作らない（ツールは今の <input type=file> を使う）', () => {
  assert.equal(load(flow, { native: false }).w.TjaApp, undefined);
});

test('ファイル選びの部品が無ければ TjaApp を作らない', () => {
  assert.equal(load(flow, { withPicker: false }).w.TjaApp, undefined);
});

/* ---------- online() ---------- */

test('online：つながっていれば true、つながっていなければ false', async () => {
  assert.equal(await load(flow, { network: fakeNetwork(true) }).w.TjaApp.online(), true);
  assert.equal(await load(flow, { network: fakeNetwork(false) }).w.TjaApp.online(), false);
});

test('online：つながりの部品が無い・失敗したときは true（止めすぎない）', async () => {
  assert.equal(await load(flow, { withNetwork: false }).w.TjaApp.online(), true);
  const broken = fakeNetwork(false, { getStatus: async () => { throw new Error('x'); } });
  assert.equal(await load(flow, { network: broken }).w.TjaApp.online(), true);
});

test('online：広告を消した人（Purchase.owned() が真）は、つながっていなくても true で、問い合わせもしない', async () => {
  const network = fakeNetwork(false);
  const { w } = load(flow, { network, extra: { Purchase: { owned: () => true } } });
  assert.equal(await w.TjaApp.online(), true);
  assert.deepEqual(network.calls, []);
  const n2 = fakeNetwork(false);
  assert.equal(await load(flow, { network: n2, extra: { Purchase: { owned: () => false } } }).w.TjaApp.online(), false);
});

/* ---------- adThenPick() ---------- */

test('adThenPick：1つだけ、中身は読まずに選ばせ、File にして返す', async () => {
  const { w, picker, fetched } = load(flow, { extra: noAd });
  const f = await w.TjaApp.adThenPick('audio');
  assert.equal(picker.calls.length, 1);
  assert.equal(picker.calls[0].limit, 1);
  assert.equal(picker.calls[0].readData, false);
  assert.ok(f instanceof File);
  assert.equal(f.name, 'うた.ogg');
  assert.equal(f.type, 'audio/ogg');
  assert.equal(await f.text(), 'abc');
  assert.deepEqual(fetched, ['capacitor://localhost/_capacitor_file_/tmp/うた.ogg']);
});

test('adThenPick：mimeType が無ければ、読んだ Blob の type を使う', async () => {
  const picker = fakePicker({ result: { files: [{ name: 'a.tja', path: 'file:///tmp/a.tja' }] } });
  const fetchImpl = async () => ({ ok: true, blob: async () => new Blob(['#START'], { type: 'text/plain' }) });
  const f = await load(flow, { picker, fetchImpl, extra: noAd }).w.TjaApp.adThenPick('import');
  assert.equal(f.name, 'a.tja');
  assert.equal(f.type, 'text/plain');
});

test('adThenPick：ogg も .tja も選べなくならないよう、種類で絞らない（iOS では全部のファイル）', async () => {
  for (const kind of ['audio', 'import']) {
    const { w, picker } = load(flow, { extra: noAd });
    await w.TjaApp.adThenPick(kind);
    assert.equal(picker.calls[0].types, undefined, kind);
  }
});

test('adThenPick：やめた（cancel）なら null', async () => {
  for (const msg of ['pickFiles canceled.', 'User cancelled']) {
    const { w } = load(flow, { picker: fakePicker({ error: new Error(msg) }), extra: noAd });
    assert.equal(await w.TjaApp.adThenPick('audio'), null, msg);
  }
  const empty = load(flow, { picker: fakePicker({ result: { files: [] } }), extra: noAd });
  assert.equal(await empty.w.TjaApp.adThenPick('import'), null, '何も選ばれなかった');
});

test('adThenPick：選んだファイルが読めなければ、ファイル名入りの「読めませんでした」で例外（ツールの知らせに任せる）', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 404 }), async () => { throw new Error('net'); }]) {
    const { w } = load(flow, { fetchImpl, extra: noAd });
    await assert.rejects(w.TjaApp.adThenPick('audio'), e => e.message === '読めませんでした（うた.ogg）' && e.code === 'read');
  }
});

test('adThenPick：ファイル選びがやめた以外で失敗したら「読めませんでした」で例外', async () => {
  const { w } = load(flow, { picker: fakePicker({ error: new Error('boom') }), extra: noAd });
  await assert.rejects(w.TjaApp.adThenPick('audio'), e => e.message === '読めませんでした' && e.code === 'pick');
});

test('adThenPick：広告が閉じてからファイル選びを開く', async () => {
  const log = [];
  let close;
  const TjaAds = { showNow: () => { log.push('showNow'); return new Promise(r => { close = () => { log.push('closed'); r(true); }; }); } };
  const { w } = load(flow, { log, extra: { TjaAds } });
  const p = w.TjaApp.adThenPick('audio');
  await flush();
  assert.deepEqual(log, ['showNow'], '閉じる前にファイル選びを開かない');
  close();
  await p;
  assert.deepEqual(log, ['showNow', 'closed', 'pickFiles']);
});

test('adThenPick：TjaAds が無い・showNow が失敗しても、ファイル選びへ進む', async () => {
  assert.ok(await load(flow).w.TjaApp.adThenPick('audio'));
  const bad = { TjaAds: { showNow: async () => { throw new Error('x'); } } };
  assert.ok(await load(flow, { extra: bad }).w.TjaApp.adThenPick('audio'));
});

test('adThenPick：選んでいる最中にもう一度呼ばれたら、2つ目は null（二重に開かない）', async () => {
  let release;
  const picker = { calls: [], pickFiles(o) { this.calls.push(o); return new Promise(r => { release = () => r({ files: [PICKED] }); }); } };
  const { w } = load(flow, { picker, extra: noAd });
  const a = w.TjaApp.adThenPick('audio');
  await flush();
  assert.equal(await w.TjaApp.adThenPick('import'), null);
  release();
  assert.ok(await a);
  assert.equal(picker.calls.length, 1);
  // 終わったあとはまた選べる
  const b = w.TjaApp.adThenPick('audio');
  await flush(); release();
  assert.ok(await b);
});

/* ---------- 本物の ads.js・purchase.js とつないだとき ---------- */

test('つないだとき：読み込み済みなら全画面広告 → 閉じる → ファイル選び', async () => {
  const log = [];
  const { w, admob } = load(all, { log });
  await flush();
  const p = w.TjaApp.adThenPick('audio');
  await flush();
  assert.deepEqual(log, ['showInterstitial'], '閉じる前にファイル選びを開かない');
  admob.handlers.interstitialAdDismissed();
  const f = await p;
  assert.deepEqual(log, ['showInterstitial', 'pickFiles']);
  assert.equal(f.name, 'うた.ogg');
});

test('つないだとき：買った人には広告を出さずにすぐファイル選び、オフラインでも online は true', async () => {
  const log = [];
  const { w } = load(all, { log, owned: true, network: fakeNetwork(false) });
  await flush();
  assert.ok(await w.TjaApp.adThenPick('import'));
  assert.deepEqual(log, ['pickFiles']);
  assert.equal(await w.TjaApp.online(), true);
});

test('つないだとき：課金が off なら買った値があっても広告を出し、オフラインは false', async () => {
  const log = [];
  const { w, admob } = load(all, { log, purchases: false, owned: true, network: fakeNetwork(false) });
  await flush();
  assert.equal(w.Purchase, undefined);
  assert.equal(await w.TjaApp.online(), false);
  const p = w.TjaApp.adThenPick('audio');
  await flush();
  admob.handlers.interstitialAdDismissed();
  await p;
  assert.deepEqual(log, ['showInterstitial', 'pickFiles']);
});
