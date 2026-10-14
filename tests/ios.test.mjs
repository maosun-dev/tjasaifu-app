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
