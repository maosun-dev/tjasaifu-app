# TJA採譜台 iPhone アプリ（tjasaifu-app）

ウェブ版 TJA採譜台（https://maosun-dev.com/tjasaifu/）を、Capacitor（ウェブのページを iPhone アプリに包む道具）で包んだもの。

- 設計・計画は tjasaifu 側：`docs/superpowers/specs/2026-10-14-iphone-app-design.md`、`docs/superpowers/plans/2026-10-14-iphone-trial.md`
- このリポジトリに入れるのは「ツールの完成品の写し（web/）」と「iPhone の包み」だけ。tjasaifu の分析用の譜面などは入れない
- 背番号（バンドルID）：`com.maosun-dev.tjasaifu`（変えられない）
- 置き場：GitHub `maosun-dev/tjasaifu-app`（作っている間は公開。ストアに出たら非公開にする）

## 作り方
1. tjasaifu で `node dist-build/build.js`（完成品 dist/tja-saifu.html を作る。ウェブ広告 ads.json は入れない状態で）
2. ここで `npm run pull-web`（完成品を web/ に写す。web/SOURCE.txt に元の版が残る）
3. フォントが変わったときだけ `node tools/fetch-fonts.mjs`
4. `npm test` → `npm run sync`（www/ を作って ios に入れる）
5. GitHub の Actions「iPhone版をTestFlightへ」で組み立てて TestFlight へ

## アプリだけの違い（build-www.mjs）
- Google Fonts → 中に入れたフォント（fonts/）
- ウェブ版の訪問者数（Tally）を外す
- 保存（TJA・zip）は iPhone の「共有」の画面を出す（js/app-native.js）
- ウェブ用の広告（AdSense）が入っていたら止まる
