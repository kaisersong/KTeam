import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolApprovalSummary} from '../src/protocol/tool-approval-summary.js';
const bash=(command:string)=>toolApprovalSummary('bash',JSON.stringify({command,timeout_ms:15000,workdir:'/fictional/home'}));
test('approval explains the complete Git read shown to the user without showing command arguments',()=>{
 const result=bash('git -C /fictional/project log -3 --oneline && git -C /fictional/project branch --show-current');
 assert.equal(result.summary,'查看最近的提交记录和当前分支');assert.equal(result.target,'project');
 assert.equal(bash('git status --short').summary,'查看项目当前的修改情况');
 assert.equal(bash('git -C "/fictional/my project" log -3 --oneline').target,'my project');
});
test('mixed, redirected, substituted and unrecognised commands are never described as just reading Git history',()=>{
 for(const command of ['git log -3 && rm -rf fictional','git log --output=fictional','git log | sh','git log; touch fictional','git log $(touch fictional)','git log `touch fictional`','git log > fictional','git log\ntouch fictional'])assert.doesNotMatch(bash(command).summary,/^查看/);
 assert.match(bash('git push origin main').summary,/推送/);assert.match(bash('git reset --hard').summary,/重置/);assert.match(bash('git clean -fd').summary,/清理/);
});
test('file, web and unknown approvals remain understandable and do not expose content or URL credentials',()=>{
 assert.deepEqual(toolApprovalSummary('write',JSON.stringify({file_path:'/fictional/report.md',content:'PRIVATE_BODY'})),{summary:'保存文件（可能覆盖已有内容）',target:'report.md'});
 assert.deepEqual(toolApprovalSummary('web_fetch',JSON.stringify({url:'https://fictional:secret@example.com/private?q=secret'})),{summary:'读取网页内容',target:'example.com'});
 assert.equal(toolApprovalSummary('unknown_tool','{}').summary,'执行一项需要你确认的操作');
 for(const display of ['not json','null','[]'])assert.equal(toolApprovalSummary('bash',display).summary,'执行一项需要你确认的操作');
});
