/* ---------- 保存の差し替え（iPhone アプリだけ。ウェブ版では読み込まれない） ----------
 * ツールは保存のときに window.claude.use('downloads') を探し、あればそれで保存する（無ければブラウザのダウンロード）。
 * アプリの中ではブラウザのダウンロードが使えないので、同じ形のものを作って渡す。
 * ・TJA・zip をアプリの一時ファイルに書いて、iPhone の「共有」の画面を出す（ファイルに保存・太鼓さん大次郎に渡す など）
 * ・大きな zip でも固まらないよう、3MB ずつ書く
 * ・browser: true は、ツールが TJA の名前に .txt を付けないための印
 */
(() => {
'use strict';
const cap = window.Capacitor;
if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
const FS = window.capacitorFilesystemPluginCapacitor;
const Filesystem = FS && FS.Filesystem;
const Share = window.capacitorShare && window.capacitorShare.Share;

const CHUNK = 3 * 1024 * 1024;   // 3 の倍数にしておくと、区切った base64 をそのまま追記できる
const fail = code => Object.assign(new Error(code), { code });

async function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());   // Blob
  throw new Error('保存できない形のデータです');
}
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const downloads = {
  browser: true,
  async save({ filename, data }) {
    const bytes = await toBytes(data);
    const dir = FS.Directory.Cache;
    let uri = null;
    for (let i = 0; i === 0 || i < bytes.length; i += CHUNK) {
      const part = base64(bytes.subarray(i, i + CHUNK));
      if (i === 0) uri = (await Filesystem.writeFile({ path: filename, directory: dir, data: part })).uri;
      else await Filesystem.appendFile({ path: filename, directory: dir, data: part });
    }
    try { await Share.share({ title: filename, files: [uri] }); }
    catch (e) { throw /cancel/i.test((e && e.message) || '') ? fail('declined') : e; }
  },
};

window.claude = {
  async use(name) {
    if (name === 'downloads') return Filesystem && Share ? downloads : null;
    return null;
  },
};
})();
