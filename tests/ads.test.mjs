// 広告（js/ads.js）と「広告を消す」の課金（js/purchase.js）のテスト。
// iPhone の部品（AdMob・課金・小さな保存）と画面は偽物を用意して、vm の中で読み込む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'com.maosundev.tjasaifu.removeads';
const KEY = 'tjasaifu-noads';
const TEST_INTER = 'ca-app-pub-3940256099942544/4411468910';
const DONE = '広告を消しました';
const NET = '通信できませんでした。少しあとでもう一度お試しください';
const NOT_FOUND = 'このApple IDでの購入は見つかりませんでした';

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// 小さな偽の画面（body の class と #toast だけ）
function fakeDocument() {
  const classList = () => ({ set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } });
  const toast = { textContent: '', classList: classList() };
  return { body: { classList: classList() }, toast, getElementById: id => (id === 'toast' ? toast : null) };
}

function fakePrefs(initial = {}, over = {}) {
  const store = { ...initial };
  return {
    store,
    get: async ({ key }) => ({ value: key in store ? store[key] : null }),
    set: async ({ key, value }) => { store[key] = value; },
    remove: async ({ key }) => { delete store[key]; },
    ...over,
  };
}

function fakeStore(over = {}) {
  const calls = { getPurchases: 0, purchaseProduct: 0, restorePurchases: 0, getProduct: 0, addListener: 0 };
  const np = {
    calls, owned: false,
    getPurchases: async () => { calls.getPurchases++; return { purchases: np.owned ? [{ productIdentifier: ID }] : [] }; },
    purchaseProduct: async () => { calls.purchaseProduct++; np.owned = true; return { productIdentifier: ID }; },
    restorePurchases: async () => { calls.restorePurchases++; },
    getProduct: async () => { calls.getProduct++; return { product: { identifier: ID, priceString: '¥600' } }; },
    addListener: async () => { calls.addListener++; return { remove() {} }; },
    ...over,
  };
  return np;
}

function fakeAdMob(over = {}) {
  const calls = [];
  const rec = name => async o => { calls.push(name); if (o) calls.push([name, o]); return {}; };
  const a = {
    calls, handlers: {}, attStatus: 'notDetermined',
    trackingAuthorizationStatus: async () => { calls.push('trackingAuthorizationStatus'); return { status: a.attStatus }; },
    requestTrackingAuthorization: rec('requestTrackingAuthorization'),
    initialize: rec('initialize'),
    addListener(n, f) { calls.push('addListener:' + n); a.handlers[n] = f; return Promise.resolve({ remove() {} }); },
    prepareInterstitial: rec('prepareInterstitial'),
    showInterstitial: rec('showInterstitial'),
    ...over,
  };
  return a;
}
const count = (admob, name) => admob.calls.filter(c => c === name).length;

// files: 読み込むスクリプト。purchases: ADS_CONFIG.purchases、production: ADS_CONFIG.production
function load(files, { native = true, production = false, purchases = true, prefs = fakePrefs(), np = fakeStore(), admob = fakeAdMob(), withToast = true } = {}) {
  const toasts = [];
  const document = fakeDocument();
  const listeners = {};
  const window = {
    document, console, Promise, toasts,
    // 10秒の見張り（SHOW_WATCHDOG）だけは 300ms に縮める（600ms の待ちは 20ms）
    setTimeout: (f, ms) => setTimeout(f, ms === 10000 ? 300 : Math.min(ms, 20)), clearTimeout,
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    moment(at) { (listeners['tja:ad-moment'] || []).forEach(f => f({ type: 'tja:ad-moment', detail: { at } })); },
  };
  if (withToast) window.toast = t => toasts.push(t);
  if (native) {
    window.Capacitor = { isNativePlatform: () => true };
    window.capacitorPreferences = { Preferences: prefs };
    window.capacitorNativePurchases = { NativePurchases: np };
    window.capacitorStripe = { AdMob: admob };
    window.ADS_CONFIG = { production, purchases };
  }
  window.window = window;
  const ctx = vm.createContext(window);
  for (const f of files) vm.runInContext(readFileSync(join(repo, f), 'utf8'), ctx, { filename: f });
  return { w: window, admob, np, prefs, document };
}
const both = ['js/purchase.js', 'js/ads.js'];

/* ---------- 広告 ---------- */

test('テストの間は Google のテスト広告の ID で読み込む', async () => {
  const { admob } = load(both);
  await flush();
  const prep = admob.calls.find(c => Array.isArray(c) && c[0] === 'prepareInterstitial');
  assert.ok(prep, 'prepareInterstitial が呼ばれていない');
  assert.equal(prep[1].adId, TEST_INTER);
  assert.equal(prep[1].isTesting, true);
  assert.equal(count(admob, 'requestTrackingAuthorization'), 1);
  assert.equal(count(admob, 'initialize'), 1);
});

test('production では本物の全画面 ID を使い、テスト扱いにしない', async () => {
  const { w, admob } = load(both, { production: true });
  await flush();
  const prep = admob.calls.find(c => Array.isArray(c) && c[0] === 'prepareInterstitial');
  assert.ok(prep, 'prepareInterstitial が呼ばれていない');
  assert.equal(prep[1].adId, 'ca-app-pub-7017663942238206/6960467426');
  assert.equal(prep[1].isTesting, false);
});

test('ad-moment で全画面広告を出す（読み込み済みのとき）', async () => {
  const { w, admob } = load(both);
  await flush();
  w.moment('load');
  assert.equal(count(admob, 'showInterstitial'), 0, 'すぐには出さない（600ms 後）');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
});

test('読み込めていないときは出さない（待たない）', async () => {
  const admob = fakeAdMob({ prepareInterstitial: () => new Promise(() => {}) });
  const { w } = load(both, { admob });
  await flush();
  w.moment('import');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 0);
});

test('買った人には ATT も広告も出さない', async () => {
  const np = fakeStore(); np.owned = true;
  const { w, admob } = load(both, { np, prefs: fakePrefs({ [KEY]: '1' }) });
  await flush();
  w.moment('export');
  await wait(40); await flush();
  assert.equal(count(admob, 'requestTrackingAuthorization'), 0);
  assert.equal(count(admob, 'trackingAuthorizationStatus'), 0);
  assert.equal(count(admob, 'prepareInterstitial'), 0);
  assert.equal(count(admob, 'showInterstitial'), 0);
});

test('Purchase.ready の前の ad-moment では出さない', async () => {
  let release;
  const prefs = fakePrefs({}, { get: () => new Promise(r => { release = r; }) });
  const { w, admob } = load(both, { prefs });
  await flush();
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 0);
  assert.equal(count(admob, 'initialize'), 0, 'ready の前は始めない');
  release({ value: null });
  await flush();
  assert.equal(count(admob, 'initialize'), 1);
  assert.equal(count(admob, 'showInterstitial'), 0, '前に来た ad-moment をあとから出さない');
});

for (const cls of ['ph-pt', 'ph-rec']) {
  test(`${cls === 'ph-pt' ? '試し叩き' : '採譜'}の間（body.${cls}）は出さない`, async () => {
    const { w, admob, document } = load(both);
    await flush();
    document.body.classList.add(cls);
    w.moment('load');
    await wait(40); await flush();
    assert.equal(count(admob, 'showInterstitial'), 0);
    // 終わったあとの次の機会には出る（読み込んだ広告は残っている）
    document.body.classList.remove(cls);
    w.moment('export');
    await wait(40); await flush();
    assert.equal(count(admob, 'showInterstitial'), 1);
  });
}

test('600ms の間に試し叩きが始まったら出さない', async () => {
  const { w, admob, document } = load(both);
  await flush();
  w.moment('load');
  document.body.classList.add('ph-pt');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 0);
});

test('一度に1枚だけ。閉じたら次を読み込み、次の機会に出す', async () => {
  const { w, admob } = load(both);
  await flush();
  w.moment('load'); w.moment('load');   // 600ms の間に2回目
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
  w.moment('export');   // 出している最中
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
  const before = count(admob, 'prepareInterstitial');
  admob.handlers.interstitialAdDismissed();
  await flush();
  assert.equal(count(admob, 'prepareInterstitial'), before + 1, '閉じたら次を読み込む');
  w.moment('import');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 2);
});

test('出せなかったときも次を読み込む', async () => {
  const { w, admob } = load(both);
  await flush();
  const before = count(admob, 'prepareInterstitial');
  admob.handlers.interstitialAdFailedToShow({});
  await flush();
  assert.equal(count(admob, 'prepareInterstitial'), before + 1);
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
});

test('使っている途中で買ったら、もう出さない', async () => {
  const { w, admob } = load(both);
  await flush();
  await w.Purchase.buy();
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 0);
});

test('600ms の間に買ったら出さない', async () => {
  const { w, admob } = load(both);
  await flush();
  w.moment('load');
  await w.Purchase.buy();
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 0);
});

test('払い戻しで買っていない状態に戻ったら広告を始める', async () => {
  const { w, admob } = load(both, { prefs: fakePrefs({ [KEY]: '1' }) });
  await flush();   // Apple は「買っていない」と答える
  assert.equal(w.Purchase.owned(), false);
  assert.equal(count(admob, 'initialize'), 1);
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
});

/* ---------- 課金の切り替え（ADS_CONFIG.purchases） ---------- */

test('課金が off：Purchase を作らず、課金の部品も呼ばない', async () => {
  const np = fakeStore();
  const prefs = fakePrefs({ [KEY]: '1' });
  let prefsRead = 0; const get = prefs.get; prefs.get = o => { prefsRead++; return get(o); };
  const { w } = load(['js/purchase.js'], { purchases: false, np, prefs });
  await flush();
  assert.equal(w.Purchase, undefined);
  assert.deepEqual(np.calls, { getPurchases: 0, purchaseProduct: 0, restorePurchases: 0, getProduct: 0, addListener: 0 });
  assert.equal(prefsRead, 0);
});

test('課金が off：覚えた値があっても、みんなに広告を出す', async () => {
  const { w, admob } = load(both, { purchases: false, prefs: fakePrefs({ [KEY]: '1' }) });
  await flush();
  assert.equal(count(admob, 'requestTrackingAuthorization'), 1);
  assert.equal(count(admob, 'initialize'), 1);
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
});

test('ウェブ版（iPhone でない）では何もしない', async () => {
  const { w } = load(both, { native: false });
  await flush();
  assert.equal(w.Purchase, undefined);
});

/* ---------- 課金 ---------- */

test('purchase：getPurchases に商品があれば owned() が真、覚えて知らせる', async () => {
  const np = fakeStore(); np.owned = true;
  const prefs = fakePrefs();
  const { w } = load(['js/purchase.js'], { np, prefs });
  const seen = []; w.Purchase.onChange(v => seen.push(v));
  await w.Purchase.ready; await flush();
  assert.equal(w.Purchase.owned(), true);
  assert.equal(prefs.store[KEY], '1');
  assert.deepEqual(seen, [true]);
});

test('purchase：電波がないときは覚えた値', async () => {
  const np = fakeStore({ getPurchases: async () => { throw new Error('offline'); } });
  const { w } = load(['js/purchase.js'], { np, prefs: fakePrefs({ [KEY]: '1' }) });
  await w.Purchase.ready; await flush();
  assert.equal(w.Purchase.owned(), true);
});

test('purchase：払い戻されたら（getPurchases に出てこない）owned() は偽、覚えた値も消す', async () => {
  const prefs = fakePrefs({ [KEY]: '1' });
  const { w } = load(['js/purchase.js'], { prefs });
  const seen = []; w.Purchase.onChange(v => seen.push(v));
  await w.Purchase.ready; await flush();
  assert.equal(w.Purchase.owned(), false);
  assert.equal(KEY in prefs.store, false);
  assert.deepEqual(seen, [false]);
});

test('purchase：決まった商品 ID で買い、買えたら「広告を消しました」', async () => {
  let asked = null;
  const np = fakeStore({ purchaseProduct: async o => { asked = o.productIdentifier; return {}; } });
  const { w } = load(['js/purchase.js'], { np });
  await w.Purchase.ready; await flush();
  await w.Purchase.buy();
  assert.equal(asked, ID);
  assert.equal(w.Purchase.owned(), true);
  assert.deepEqual(w.toasts, [DONE]);
});

test('purchase：途中でやめた・承認待ちは何も出さない', async () => {
  for (const err of [new Error('User cancelled'), new Error('Transaction pending')]) {
    const np = fakeStore({ purchaseProduct: async () => { throw err; } });
    const { w } = load(['js/purchase.js'], { np });
    await w.Purchase.ready; await flush();
    await w.Purchase.buy();
    assert.deepEqual(w.toasts, [], err.message);
    assert.equal(w.Purchase.owned(), false);
  }
});

test('purchase：ほかの失敗は通信の知らせ、buy は終わる', async () => {
  const np = fakeStore({ purchaseProduct: async () => { throw new Error('network'); } });
  const { w } = load(['js/purchase.js'], { np });
  await w.Purchase.ready; await flush();
  await w.Purchase.buy();
  assert.deepEqual(w.toasts, [NET]);
  assert.equal(w.Purchase.owned(), false);
});

test('restore で見つからなければ「このApple IDでの購入は見つかりませんでした」', async () => {
  const { w } = load(['js/purchase.js']);
  await w.Purchase.ready; await flush();
  await w.Purchase.restore();
  assert.deepEqual(w.toasts, [NOT_FOUND]);
  assert.equal(w.Purchase.owned(), false);
});

test('restore で見つかれば「広告を消しました」', async () => {
  const np = fakeStore(); np.restorePurchases = async () => { np.owned = true; };
  const { w } = load(['js/purchase.js'], { np });
  await w.Purchase.ready; await flush();
  await w.Purchase.restore();
  assert.equal(w.Purchase.owned(), true);
  assert.deepEqual(w.toasts, [DONE]);
});

test('restore でつながらなければ通信の知らせ、restore は終わる', async () => {
  for (const over of [{ restorePurchases: async () => { throw new Error('offline'); } }, { getPurchases: async () => { throw new Error('offline'); } }]) {
    const { w } = load(['js/purchase.js'], { np: fakeStore(over) });
    await w.Purchase.ready; await flush();
    await w.Purchase.restore();
    assert.deepEqual(w.toasts, [NET]);
  }
});

test('値段が取れると price() はその文字、取れないと null', async () => {
  const a = load(['js/purchase.js']);
  await a.w.Purchase.ready; await flush();
  assert.equal(a.w.Purchase.price(), '¥600');
  const b = load(['js/purchase.js'], { np: fakeStore({ getProduct: async () => { throw new Error('offline'); } }) });
  await b.w.Purchase.ready; await flush();
  assert.equal(b.w.Purchase.price(), null);
});

test('連打しても1回だけ買う', async () => {
  const np = fakeStore();
  const { w } = load(['js/purchase.js'], { np });
  await w.Purchase.ready; await flush();
  await Promise.all([w.Purchase.buy(), w.Purchase.buy()]);
  assert.equal(np.calls.purchaseProduct, 1);
});

test('window.toast が無ければ、ツールの #toast に出す', async () => {
  const { w, document } = load(['js/purchase.js'], { withToast: false });
  await w.Purchase.ready; await flush();
  await w.Purchase.restore();
  assert.equal(document.toast.textContent, NOT_FOUND);
  assert.equal(document.toast.classList.contains('show'), true);
  await wait(40);
  assert.equal(document.toast.classList.contains('show'), false, 'しばらくしたら消える');
});

test('全画面広告を出したのに知らせが10秒来なければ、showing を戻して次を読み込む', async () => {
  const { w, admob } = load(both);
  await flush();
  w.moment('load');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 1);
  const before = count(admob, 'prepareInterstitial');
  await wait(100); await flush();
  assert.equal(count(admob, 'prepareInterstitial'), before, '見張りの時間（縮めて300ms）の前は動かない');
  await wait(300); await flush();
  assert.equal(count(admob, 'prepareInterstitial'), before + 1, '見張りで次を読み込む');
  w.moment('export');
  await wait(40); await flush();
  assert.equal(count(admob, 'showInterstitial'), 2, 'showing が戻っているので次も出る');
});

test('閉じた知らせが先に来たら、見張りは何もしない', async () => {
  const { w, admob } = load(both);
  await flush();
  w.moment('load');
  await wait(40); await flush();
  admob.handlers.interstitialAdDismissed();
  await flush();
  const before = count(admob, 'prepareInterstitial');
  await wait(400); await flush();
  assert.equal(count(admob, 'prepareInterstitial'), before, '二重に読み込まない');
});
