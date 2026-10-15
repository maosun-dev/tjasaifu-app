/* ---------- 曲・ファイルを選ぶ流れ（iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * ツールは window.TjaApp があるときだけ使い、無ければ今の <input type=file> を使う。
 * ・online()：インターネットにつながっているか。広告を消した人（Purchase.owned() が真）は常に true。
 *   つながりの部品が無い・問い合わせに失敗したときも true（止めすぎない）
 * ・adThenPick(kind)：全画面広告（出せれば。js/ads.js の TjaAds.showNow）→ 閉じるのを待つ → iPhone 本体のファイル選び → File
 *   WebKit は指で押した直後でないと <input type=file> を開けないので、広告のあとは本体のファイル選びを使う
 *   広告を出したとき（showNow が true）は、閉じる動きが終わるよう 300ms 待ってからファイル選びを開く
 *   やめた・何も選ばなかった・選んでいる最中にもう一度呼ばれた：null
 *   ただし前の選びが 60秒より長く終わらない（ファイル選びが開けずに固まった）ときは、前のを捨てて新しく開く
 *   （最後の守り。捨てた前の呼び出しがあとで終わっても、新しいほうの「選んでいる最中」は消さない）
 *   読むときは Range: bytes=0- を付ける（付けないと iOS で mp3・wav が読めない。206 も r.ok）
 *   選んだファイルが読めない：例外（message は「読めませんでした（名前）」、code は 'read'）。ツールが知らせを出す
 *   ファイル選びがやめた以外で失敗：例外（message は「読めませんでした」、code は 'pick'）
 * ・showAd()：書き出す前の全画面広告（出せれば）→ 閉じるのを待つ。ファイル選びは開かない。いつも resolve（値なし）
 *   広告を出したときは adThenPick と同じく 300ms 待ってから終わる。TjaAds が無い・失敗・出せないときはすぐ終わる
 * ・picking：いまファイルを選んでいる最中か（読むだけ。60秒を過ぎたものは数えない）。js/ads.js が書き出しの広告を重ねないために見る
 * ・種類では絞らない（全部のファイルを選べる）。部品の types は MIME の名前しか受け付けず、
 *   .tja には iPhone の決まった種類が無く、ogg も種類で選べるか確かめられないため。違うファイルはツールが「読めませんでした」で断る
 */
(() => {
'use strict';
const cap = window.Capacitor;
if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
const FilePicker = window.capacitorFilePicker && window.capacitorFilePicker.FilePicker;
if (!FilePicker) return;   // 部品が無ければ作らない（ツールは今の <input type=file> を使う）

const fail = (message, code) => Object.assign(new Error(message), { code });
const AFTER_AD = 300;     // 広告を閉じてからファイル選びを開くまで（閉じる動きが終わるのを待つ）
const STALE = 60000;     // 選んでいる最中がこれより長く続いたら、固まったとみなす
let pickToken = null, pickAt = 0;   // いま選んでいる呼び出しの印と、始めた時刻
const isPicking = () => pickToken !== null && Date.now() - pickAt < STALE;

async function online() {
  try { if (window.Purchase && window.Purchase.owned()) return true; } catch (e) {}
  const Network = window.capacitorNetwork && window.capacitorNetwork.Network;
  if (!Network) return true;
  try {
    const s = await Network.getStatus();
    return !(s && s.connected === false);
  } catch (e) { return true; }
}

// 全画面広告（出せれば）を出して閉じるのを待つ。出したときは閉じる動きが終わるまで待つ
async function showAd() {
  let ad = false;
  try { if (window.TjaAds) ad = await window.TjaAds.showNow(); } catch (e) {}   // 広告が出せなくても先へ
  if (ad) await new Promise(r => setTimeout(r, AFTER_AD));
}

// kind：'audio'（曲から作る）| 'import'（ファイルから入れる）。今はどちらも同じ選び方
async function adThenPick(kind) {
  if (isPicking()) return null;
  const token = {};
  pickToken = token; pickAt = Date.now();
  try {
    await showAd();
    let res;
    try { res = await FilePicker.pickFiles({ limit: 1, readData: false }); }
    catch (e) {
      if (/cancel/i.test((e && e.message) || '')) return null;
      throw fail('読めませんでした', 'pick');
    }
    const p = res && res.files && res.files[0];
    if (!p) return null;
    const name = p.name || 'file';
    let blob;
    try {
      // Range を付ける：iOS の Capacitor は Range の無い要求のうち mp3・wav など（音・動画の種類）だけ
      // HTTP の応答でない形で返し、r.ok が偽になって読めない。Range があればどの種類も 206 で全体を返す
      const r = await fetch(cap.convertFileSrc(p.path), { headers: { Range: 'bytes=0-' } });
      if (!r.ok) throw new Error(String(r.status));
      blob = await r.blob();
    } catch (e) { throw fail('読めませんでした（' + name + '）', 'read'); }
    return new File([blob], name, { type: p.mimeType || blob.type || '' });
  } finally { if (pickToken === token) pickToken = null; }
}

window.TjaApp = { online, adThenPick, showAd, get picking() { return isPicking(); } };
})();
