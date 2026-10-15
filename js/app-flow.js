/* ---------- 曲・ファイルを選ぶ流れ（iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * ツールは window.TjaApp があるときだけ使い、無ければ今の <input type=file> を使う。
 * ・online()：インターネットにつながっているか。広告を消した人（Purchase.owned() が真）は常に true。
 *   つながりの部品が無い・問い合わせに失敗したときも true（止めすぎない）
 * ・adThenPick(kind)：全画面広告（出せれば。js/ads.js の TjaAds.showNow）→ 閉じるのを待つ → iPhone 本体のファイル選び → File
 *   WebKit は指で押した直後でないと <input type=file> を開けないので、広告のあとは本体のファイル選びを使う
 *   やめた・何も選ばなかった・選んでいる最中にもう一度呼ばれた：null
 *   選んだファイルが読めない：例外（message は「読めませんでした（名前）」、code は 'read'）。ツールが知らせを出す
 *   ファイル選びがやめた以外で失敗：例外（message は「読めませんでした」、code は 'pick'）
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
let picking = false;

async function online() {
  try { if (window.Purchase && window.Purchase.owned()) return true; } catch (e) {}
  const Network = window.capacitorNetwork && window.capacitorNetwork.Network;
  if (!Network) return true;
  try {
    const s = await Network.getStatus();
    return !(s && s.connected === false);
  } catch (e) { return true; }
}

// kind：'audio'（曲から作る）| 'import'（ファイルから入れる）。今はどちらも同じ選び方
async function adThenPick(kind) {
  if (picking) return null;
  picking = true;
  try {
    try { if (window.TjaAds) await window.TjaAds.showNow(); } catch (e) {}   // 広告が出せなくても先へ
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
      const r = await fetch(cap.convertFileSrc(p.path));
      if (!r.ok) throw new Error(String(r.status));
      blob = await r.blob();
    } catch (e) { throw fail('読めませんでした（' + name + '）', 'read'); }
    return new File([blob], name, { type: p.mimeType || blob.type || '' });
  } finally { picking = false; }
}

window.TjaApp = { online, adThenPick };
})();
