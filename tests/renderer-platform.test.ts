import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientPlatform,speechSupported} from '../desktop/renderer/src/platform.js';

const windows={userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KTeam/0.4.0 Chrome/140 Electron/42.11.16 Safari/537.36',platform:'Win32'};
const mac={userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) KTeam/0.4.0 Chrome/140 Electron/42.11.16 Safari/537.36',platform:'MacIntel'};

test('speech (message read-aloud) is offered on macOS and hidden on Windows',()=>{
 assert.equal(clientPlatform(windows),'windows');assert.equal(speechSupported(windows),false);
 assert.equal(clientPlatform({userAgentData:{platform:'Windows'}}),'windows');
 assert.equal(clientPlatform(mac),'mac');assert.equal(speechSupported(mac),true);
 assert.equal(clientPlatform({}),'other');
});

test('read-aloud menu item and the voice settings speech block are gated by speechSupported',()=>{
 const components=readFileSync('desktop/renderer/src/components.tsx','utf8'),voice=readFileSync('desktop/renderer/src/integration-settings.tsx','utf8');
 assert.match(components,/\{speechSupported\(\)&&<button role="menuitem"[^}]*'stopSpeech':'speak'/);
 assert.match(voice,/const speech=speechSupported\(\)/);assert.match(voice,/\{speech&&<><h3>消息朗读<\/h3>/);
 assert.match(voice,/if\(!speech\)return;void api\.voiceOptions\(\)/);
 // Voice input (Whisper-compatible endpoint) stays available everywhere.
 assert.match(voice,/<\/>\}<h3>语音输入<\/h3>/);
});

test('credential storage copy names both system stores',()=>{
 const models=readFileSync('desktop/renderer/src/model-settings.tsx','utf8');
 assert.match(models,/<option value="keychain">系统凭据（Mac 钥匙串 \/ Windows 凭据管理器）<\/option>/);
 assert.doesNotMatch(models,/>Mac 钥匙串</);
});
