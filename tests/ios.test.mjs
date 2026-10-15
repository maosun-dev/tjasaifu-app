// iPhone の包み（ios/）の設定のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ios = join(dirname(fileURLToPath(import.meta.url)), '..', 'ios/App');

test('消音スイッチが入っていても曲とヒット音が鳴る（音の種類を playback にする）', () => {
  const s = readFileSync(join(ios, 'App/AppDelegate.swift'), 'utf8');
  assert.match(s, /import AVFoundation/);
  assert.match(s, /setCategory\(\.playback/);
});

test('iPhone は横向きだけ', () => {
  const p = readFileSync(join(ios, 'App/Info.plist'), 'utf8');
  const iphone = p.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/)[1];
  assert.ok(!iphone.includes('Portrait'));
  assert.ok(iphone.includes('LandscapeLeft') && iphone.includes('LandscapeRight'));
});

test('Info.plist：AdMob のアプリID（本物。ストア向けの組み立てで本物に決まっている）・追跡の許可の文・SKAdNetworkItems', () => {
  const p = readFileSync(join(ios, 'App/Info.plist'), 'utf8');
  assert.match(p, /<key>GADApplicationIdentifier<\/key>\s*<string>ca-app-pub-7017663942238206~1946234883<\/string>/);
  assert.match(p, /<key>NSUserTrackingUsageDescription<\/key>\s*<string>許可すると、あなたの興味に合った広告が表示されやすくなります。許可しなくても、アプリはすべて使えます。<\/string>/);
  const items = p.match(/<key>SKAdNetworkItems<\/key>\s*<array>([\s\S]*?)<\/array>\s*(?:<key>|<\/dict>)/)[1];
  assert.ok((items.match(/<key>SKAdNetworkIdentifier<\/key>/g) || []).length >= 1, 'SKAdNetwork の一覧が空');
  assert.ok(items.includes('cstr6suwn9.skadnetwork'), 'Google の ID が無い');
});

test('包みの部品：AdMob・課金・Preferences が入っている', () => {
  const pkg = JSON.parse(readFileSync(join(ios, '..', '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@capacitor-community/admob'], '8.1.0');
  assert.equal(pkg.dependencies['@capgo/native-purchases'], '8.9.5');
  assert.equal(pkg.dependencies['@capacitor/preferences'], '8.0.1');
});

test('PrivacyInfo.xcprivacy：追跡なし・UserDefaults の理由 CA92.1。Xcode の Resources に入っている', () => {
  const x = readFileSync(join(ios, 'App/PrivacyInfo.xcprivacy'), 'utf8');
  assert.match(x, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(x, /<key>NSPrivacyAccessedAPITypes<\/key>/);
  assert.match(x, /<string>NSPrivacyAccessedAPICategoryUserDefaults<\/string>/);
  assert.match(x, /<string>CA92\.1<\/string>/);
  const pbx = readFileSync(join(ios, 'App.xcodeproj/project.pbxproj'), 'utf8');
  const ref = pbx.match(/(\w{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference/);
  assert.ok(ref, 'PBXFileReference が無い');
  assert.ok(pbx.includes('\t\t\t\t' + ref[1] + ' /* PrivacyInfo.xcprivacy */,'), 'グループに入っていない');
  const build = pbx.match(/(\w{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile; fileRef = (\w{24})/);
  assert.ok(build && build[2] === ref[1], 'PBXBuildFile が無い');
  const phase = pbx.match(/\/\* Begin PBXResourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXResourcesBuildPhase section \*\//)[1];
  assert.ok(phase.includes(build[1]), 'Resources の段に入っていない');
  assert.equal(pbx.split(ref[1]).length - 1, 3 + 0, '登録の数が合わない（FileReference・BuildFile の中・グループ）');
});

test('ワークフロー：production の入力があり、ADS_PRODUCTION を www を作る段に渡している', () => {
  const y = readFileSync(join(ios, '..', '..', '.github/workflows/ios-testflight.yml'), 'utf8');
  assert.match(y, /inputs:[\s\S]*?production:\s*\r?\n\s*description: '[^']*本物の広告[^']*'\s*\r?\n\s*type: boolean\s*\r?\n\s*default: false/);
  assert.match(y, /name: アプリのファイルを入れる\s*\r?\n\s*env:[\s\S]*?ADS_PRODUCTION: \$\{\{ inputs\.production && '1' \|\| '' \}\}[\s\S]*?run: \|/);
});

test('ワークフロー：purchases の入力があり、PURCHASES を www を作る段に渡している', () => {
  const y = readFileSync(join(ios, '..', '..', '.github/workflows/ios-testflight.yml'), 'utf8');
  assert.match(y, /inputs:[\s\S]*?purchases:\s*\r?\n\s*description: '[^']*広告を消す[^']*'\s*\r?\n\s*type: boolean\s*\r?\n\s*default: false/);
  assert.match(y, /name: アプリのファイルを入れる\s*\r?\n\s*env:[\s\S]*?PURCHASES: \$\{\{ inputs\.purchases && '1' \|\| '' \}\}[\s\S]*?run: \|/);
});

test('Info.plist：写真の説明の文（ファイル選びの部品が写真のしくみを含むため。持ち主が決めた文のまま）', () => {
  const p = readFileSync(join(ios, 'App/Info.plist'), 'utf8');
  assert.match(p, /<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>このアプリは写真を使いません。ファイルを選ぶしくみの決まりで、この説明が入っています。<\/string>/);
});
