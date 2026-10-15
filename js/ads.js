/* ---------- 広告（AdMob の全画面広告だけ。iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * 手本はワンタップ収支の js/ads.js（バナーは使わないので外した）。
 * ・ツールが window に出す知らせ tja:ad-moment（detail.at = 'load' | 'import' | 'export'）のたびに、全画面広告を出す
 *   出すのは 600ms 後（画面が切り替わったのが見えてから）。毎回出す
 * ・出さないとき：前もって読み込めていない（待たせない）・ほかの広告を出している／出す予定・
 *   試し叩き（body.ph-pt）や採譜（body.ph-rec）の最中・広告を消した人
 * ・閉じたら（出せなかったときも）次の広告を読み込んでおく
 * ・起動のとき：Purchase.ready（端末に覚えた値）を待つ → 買っていなければ追跡の許可（ATT）を聞く → initialize → 読み込む
 *   課金が off（ADS_CONFIG.purchases が false。window.Purchase が無い）ならみんなに出すので、待たずに始める
 * 開発中は Google のテスト広告。ストアに出す版だけ本物（ADS_PRODUCTION=1 で組み立てたとき）。
 * 本物の ID（REAL_INTERSTITIAL）が空のまま ADS_PRODUCTION=1 で組み立てようとすると、tools/build-www.mjs が止める。
 */
(() => {
'use strict';
const cfg = window.ADS_CONFIG || null;            // tools/build-www.mjs が js/app-info.js で作る
const plugin = window.capacitorStripe || null;    // @capacitor-community/admob（配布ファイルのグローバル名がこの名前）
const cap = window.Capacitor;
const native = !!(cfg && plugin && plugin.AdMob && cap && cap.isNativePlatform && cap.isNativePlatform());
if (!native) return;
const production = !!cfg.production;

// Google が用意しているテスト用の全画面広告（開発中はこちらを使う）
const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/4411468910';
// 本物の全画面広告の ID（ストアに出す版だけで使う）。AdMob でこのアプリ用に作った ID（アプリ ID は ios/App/App/Info.plist）
const REAL_INTERSTITIAL = 'ca-app-pub-7017663942238206/6960467426';
const adId = production ? REAL_INTERSTITIAL : TEST_INTERSTITIAL;
if (!adId) return;
const AdMob = plugin.AdMob;
const DELAY = 600;   // 画面が切り替わってから出すまで

let started = false, inited = false, noAds = false;
let interReady = false, loading = false, showing = false;
let retryTimer = null;

// 試し叩き・採譜の最中は出さない（叩いている途中に広告が出ると困る）
const busyPlaying = () => {
  const c = document.body && document.body.classList;
  return !!c && (c.contains('ph-pt') || c.contains('ph-rec'));
};

function loadInter() {
  if (noAds || !inited || interReady || loading) return;
  loading = true;
  AdMob.prepareInterstitial({ adId, isTesting: !production })
    .then(() => { loading = false; if (!noAds) interReady = true; })
    .catch(() => { loading = false; clearTimeout(retryTimer); retryTimer = setTimeout(loadInter, 60000); });
}
function finishInter() { showing = false; interReady = false; loadInter(); }

function onMoment() {
  if (noAds || !interReady || showing || busyPlaying()) return;   // 読み込めていなければ、その回は出さない
  showing = true;
  setTimeout(() => {
    // 待っている間に買われた・試し叩きなどが始まった：出さない（読み込んだ広告は次の機会に使う）
    if (noAds || busyPlaying()) { showing = false; return; }
    interReady = false;
    Promise.resolve().then(() => AdMob.showInterstitial()).catch(finishInter);
  }, DELAY);
}
window.addEventListener('tja:ad-moment', onMoment);

async function init() {
  if (started) return;
  started = true;
  try {
    const s = await AdMob.trackingAuthorizationStatus();
    if (s && s.status === 'notDetermined') await AdMob.requestTrackingAuthorization();
  } catch (e) {}
  if (noAds) { started = false; return; }   // 聞いている間に買われた
  try { await AdMob.initialize({ initializeForTesting: !production }); } catch (e) { started = false; return; }
  inited = true;
  try { AdMob.addListener('interstitialAdDismissed', finishInter); } catch (e) {}
  try { AdMob.addListener('interstitialAdFailedToShow', finishInter); } catch (e) {}
  loadInter();
}

/* ---------- 広告を消す（js/purchase.js の window.Purchase）とのつながり ---------- */
function stopAds() { noAds = true; interReady = false; clearTimeout(retryTimer); }
function startAds() { noAds = false; if (inited) loadInter(); else init(); }
const purchase = cfg.purchases ? window.Purchase || null : null;
if (purchase) {
  purchase.onChange(owned => { if (owned) stopAds(); else startAds(); });   // 買った・払い戻しで戻った
  Promise.resolve(purchase.ready).then(() => {
    let owned = false;
    try { owned = !!purchase.owned(); } catch (e) {}
    if (owned) stopAds(); else startAds();
  }, () => startAds());
} else init();
})();
