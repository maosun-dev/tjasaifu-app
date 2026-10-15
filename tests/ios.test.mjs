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

test('Info.plist：AdMob のアプリID（いまは Google のテスト用）・追跡の許可の文・SKAdNetworkItems', () => {
  const p = readFileSync(join(ios, 'App/Info.plist'), 'utf8');
  assert.match(p, /<key>GADApplicationIdentifier<\/key>\s*<string>ca-app-pub-3940256099942544~1458002511<\/string>/);
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
