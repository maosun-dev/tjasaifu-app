/* ---------- 広告（AdMob の全画面広告だけ。iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * 手本はワンタップ収支の js/ads.js（バナーは使わないので外した）。
 * ・「曲から作る」「ファイルから入れる」を押したとき：js/app-flow.js が window.TjaAds.showNow() を呼ぶ
 *   出せればすぐ全画面広告を出し、閉じた・出せなかった・10秒の見張りのどれかで true。出せないときはすぐ false
 *   10秒の見張りは「広告が出なかった（何の知らせも来ない）」ときだけ。出た（Showed）あとは閉じるまで待つ
 *   （長い動画の広告の途中でファイル選びを開くと、iPhone が開いてくれず固まるため）
 *   （押した直後なので 600ms は待たない。終わったらファイル選びを開く）
 * ・「書き出す」を押したとき：ツールが window.TjaApp.showAd()（js/app-flow.js）を呼び、それが showNow() を呼ぶ（保存の前に出す）
 * ・（古い受け口）知らせ tja:ad-moment の書き出したあと（detail.at = 'export'）で全画面広告を出す。
 *   今のツールは書き出しの前に showAd を使うので、この知らせはもう出さない（古いツールのために残してある）
 *   出すのは 600ms 後（画面が切り替わったのが見えてから）。毎回出す。ファイルを選んでいる最中（TjaApp.picking）は出さない
 *   'load'（読み込んだあと）・'import'（入れたあと）は、選ぶ前に出すようにしたので出さない
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
const SHOW_WATCHDOG = 10000;   // 出してから、閉じた・出せなかったの知らせがこれだけ来なければ見切る（iOS の AdMob は画面が取れないと何も返さない）

let started = false, inited = false, noAds = false;
let interReady = false, loading = false, showing = false, shown = false;   // shown：いま出している広告が画面に出た
let retryTimer = null, watchdog = null;
let waiters = [];   // showNow() で閉じるのを待っているもの

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
function finishInter() {
  clearTimeout(watchdog); showing = false; shown = false; interReady = false;
  const w = waiters; waiters = [];
  for (const f of w) f(true);   // showNow() を待っているもの：閉じた（出せなかった・見切った）ので先へ
  loadInter();
}
// 全画面広告を出す（showing はもう true にしてあること）
function showInter() {
  interReady = false;
  clearTimeout(watchdog);
  shown = false;
  // 知らせが来なければ showing を戻して次を読み込む。出た（Showed）あとは見切らない（閉じる・出せなかったの知らせを待つ）
  watchdog = setTimeout(() => { if (!shown) finishInter(); }, SHOW_WATCHDOG);
  Promise.resolve().then(() => AdMob.showInterstitial()).catch(finishInter);
}

function onShowed() { if (showing) { shown = true; clearTimeout(watchdog); } }
// ファイルを選んでいる最中（js/app-flow.js）は出さない（ファイル選びの上に重ねない）
const picking = () => { try { return !!(window.TjaApp && window.TjaApp.picking); } catch (e) { return false; } };

function onMoment(e) {
  if (!e || !e.detail || e.detail.at !== 'export') return;   // 書き出したあとだけ
  if (noAds || !interReady || showing || busyPlaying() || picking()) return;   // 読み込めていなければ、その回は出さない
  showing = true;
  setTimeout(() => {
    // 待っている間に買われた・試し叩きなどが始まった：出さない（読み込んだ広告は次の機会に使う）
    if (noAds || busyPlaying() || picking()) { showing = false; return; }
    showInter();
  }, DELAY);
}
window.addEventListener('tja:ad-moment', onMoment);

// 選ぶ前の広告。出せるならすぐ出して、閉じたら true。出せないときはすぐ false（待たせない）
window.TjaAds = {
  showNow() {
    if (noAds || !interReady || showing) return Promise.resolve(false);
    showing = true;
    return new Promise(r => { waiters.push(r); showInter(); });
  },
};

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
  try { AdMob.addListener('interstitialAdShowed', onShowed); } catch (e) {}
  loadInter();
}

/* ---------- 広告を消す（js/purchase.js の window.Purchase）とのつながり ---------- */
function stopAds() {
  noAds = true; interReady = false; clearTimeout(retryTimer); clearTimeout(watchdog);
  const w = waiters; waiters = []; for (const f of w) f(true);   // 待っているものは止めずに先へ
}
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
