/* ---------- 広告を消す（買い切りのアプリ内課金。iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * 手本はワンタップ収支の js/purchase.js。画面の行は作らない（ツールの「このアプリについて」が window.Purchase を読んで出す）。
 * ・課金は ADS_CONFIG.purchases が true のときだけ（PURCHASES=1 で組み立てたとき）。
 *   false のときは window.Purchase を作らず、課金の部品にも触らない（画面の「広告を消す」の行は出ない、広告はみんなに出る）
 * ・起動のたびに Apple に「この Apple ID が今も持っている購入」を問い合わせる（払い戻された購入は出てこないので外れる）
 * ・結果は端末にも覚える（Preferences の NOADS_KEY）。電波がなくて問い合わせられないときは、覚えた値を使う
 * ・window.Purchase = { ready（覚えた値で決まる。持っていないときだけ Apple を3秒まで待つ）, owned(), price(), buy(), restore(), onChange(fn), onPrice(fn) }
 * ・買う・復元の結果の知らせ（トースト）はここで出す。途中でやめたときは何も出さない。buy・restore は失敗しても必ず終わる
 * 課金の項目は App Store Connect で作る（非消耗型、PRODUCT_ID、日本 600円）。
 */
(() => {
'use strict';
const cap = window.Capacitor;
if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
const cfg = window.ADS_CONFIG || null;
if (!cfg || !cfg.purchases) return;   // 課金の切り替えが off
const NP = window.capacitorNativePurchases && window.capacitorNativePurchases.NativePurchases;
const P = window.capacitorPreferences && window.capacitorPreferences.Preferences;
if (!NP || !P) return;

const PRODUCT_ID = 'com.maosundev.tjasaifu.removeads';
const NOADS_KEY = 'tjasaifu-noads';
const MSG = {
  done: '広告を消しました',
  net: '通信できませんでした。少しあとでもう一度お試しください',
  notFound: 'このApple IDでの購入は見つかりませんでした',
};

let owned = false, busy = false, priceText = null, seq = 0;
const listeners = [], priceListeners = [];

// 知らせ。ツールの toast() は外から呼べないので、同じ #toast を同じやり方（show を付けて 1.8 秒）で使う
let toastTimer = null;
function say(t) {
  if (typeof window.toast === 'function') { try { window.toast(t); } catch (e) {} return; }
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer);
  // そのあとツールが別の知らせを出していたら、それは消さない
  toastTimer = setTimeout(() => { if (el.textContent === t) el.classList.remove('show'); }, 1800);
}

function setOwned(v) {
  seq++;   // これより前に出した問い合わせの返事は、あとから届いても使わない
  if (v === owned) return;
  owned = v;
  (v ? P.set({ key: NOADS_KEY, value: '1' }) : P.remove({ key: NOADS_KEY })).catch(() => {});
  for (const f of listeners) { try { f(v); } catch (e) {} }
}

// Apple に問い合わせる。true / false、つながらなければ null（覚えた値のまま）
async function check() {
  const mine = ++seq;
  try {
    const { purchases } = await NP.getPurchases({ onlyCurrentEntitlements: true });
    if (mine !== seq) return owned;   // 問い合わせている間に、買った・もっと新しい問い合わせが済んだ。古い返事で上書きしない
    const has = (purchases || []).some(t => t && t.productIdentifier === PRODUCT_ID);
    setOwned(has);
    return has;
  } catch (e) { return null; }
}

// 途中でやめた（"User cancelled"）・保護者の承認待ち（"Transaction pending"。あとで届いたら transactionUpdated で拾う）は知らせを出さない
// 日本語の端末では「キャンセルされました」のように返ってくることもある
const quiet = e => !!e && (e.code === 'USER_CANCELLED' || /cancel|pending|キャンセル|取り消/i.test(String(e.message || e)));

async function buy() {
  if (busy || owned) return;
  busy = true;
  try {
    await NP.purchaseProduct({ productIdentifier: PRODUCT_ID });
    setOwned(true);
    say(MSG.done);
  } catch (e) {
    if (!quiet(e)) say(MSG.net);
  } finally { busy = false; }
}

async function restore() {
  if (busy) return;
  busy = true;
  try {
    await NP.restorePurchases();
    const has = await check();
    say(has === null ? MSG.net : has ? MSG.done : MSG.notFound);
  } catch (e) {
    if (!quiet(e)) say(MSG.net);
  } finally { busy = false; }
}

/* ---------- 起動時 ---------- */
// 入れ直した直後は覚えた値が空なので、買ってあっても「持っていない」に見える。そのまま追跡の許可（ATT）や広告を始めないよう、
// 持っていないと覚えているときだけ、Apple への問い合わせを少し（3秒まで）待つ。電波がなければ待たずに先へ進む
const WAIT_MS = 3000;
const first = new Promise(res => { setTimeout(res, WAIT_MS); });
const ready = P.get({ key: NOADS_KEY })
  .then(r => { owned = !!r && r.value === '1'; return owned ? owned : Promise.race([check(), first]).then(() => owned); })
  .catch(() => false);
ready.then(() => {
  check();   // 買った覚えがあっても、払い戻されていないか毎回確かめる
  NP.getProduct({ productIdentifier: PRODUCT_ID })
    .then(r => {
      priceText = (r && r.product && r.product.priceString) || null;
      for (const f of priceListeners) { try { f(priceText); } catch (e) {} }   // 値段が遅れて届いたら画面を描き直せるように
    })
    .catch(() => {});
  // 承認待ちだった購入や、別の端末での購入が届いたとき
  try { Promise.resolve(NP.addListener('transactionUpdated', () => { check(); })).catch(() => {}); } catch (e) {}
});

window.Purchase = {
  ready,
  owned: () => owned,
  price: () => priceText,
  buy,
  restore,
  onChange: fn => { listeners.push(fn); },
  onPrice: fn => { priceListeners.push(fn); },
};
})();
