import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHarness as localHarness} from '../src/runtime/harness.js';
import {pathToFileURL} from 'node:url';
const createHarness:typeof localHarness=process.env.KTEAM_HARNESS_ENTRY?(await import(pathToFileURL(process.env.KTEAM_HARNESS_ENTRY).href)).createHarness:localHarness;
import {appResources} from '../src/service/app-settings.js';
import {creatorPluginRoot} from '../src/runtime/creator-plugins.js';

test('bundled creators render real files through the KTeam registry, preserve approvals, fence private paths and reopen cleanly',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-creators-'))),cwd=join(root,'workspace'),config=join(root,'config'),privateRoot=join(root,'private-host');mkdirSync(cwd);mkdirSync(config);mkdirSync(privateRoot);
 const before=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=config;
 let owner:any,current=true,approve=true;const records:any[]=[],prompts:any[]=[],events:any[]=[];
 const open=async()=>{const h=await createHarness({scope:{root:privateRoot,botId:'creator',roomId:'creator-room',bindingRevision:1,fingerprint:'fixture',profileRevision:1},workspace:cwd,signal:AbortSignal.timeout(60000),assertCurrent:async()=>{if(!current)throw Error('creator_revoked');},onPrompt:async(name,args)=>{prompts.push({name,args});return approve;},onTool:e=>events.push(e),onProcess:r=>{records.push(r);}});return h.prepare!({getModelName:()=> 'fixture'},'fixture',h.system,[]);};
 const ir='---\ntitle: 示例项目周报\ntheme: minimal\nlang: zh\ndate: 2026-01-01\nabstract: 以下仅为测试用虚构数据\n---\n\n## 本周进展\n\n示例项目完成了首轮验证，下面的数据为虚构测试数据。\n\n:::kpi\n- label: 已验证事项\n  value: 3\n:::\n';
 try{
  const resources=await appResources();assert.ok(resources.skills.some((s:any)=>s.name==='kai-report-creator'));
  owner=await open();const call=(name:string,args:any)=>owner.registry.executeTool(name,args);
  assert.match(await call('skill',{name:'kai-report-creator'}),/ir_content/);
  assert.match(await call('skillFetchAssets',{skillName:'kai-report-creator',kind:'references',paths:['references/ir-contract.md']}),/report_class|frontmatter|title/);
  const valid=JSON.parse(await call('mcp__report-renderer__validate_ir',{ir_content:ir}));assert.equal(valid.valid,true,JSON.stringify(valid));
  approve=false;assert.match(await call('mcp__report-renderer__render_report',{ir_content:ir,output_path:'report.html'}),/denied|拒绝|permission|取消/i);assert.equal(existsSync(join(cwd,'report.html')),false);approve=true;
  const rendered=JSON.parse(await call('mcp__report-renderer__render_report',{ir_content:ir,output_path:'report.html'}));assert.equal(rendered.success,true,JSON.stringify(rendered));assert.match(readFileSync(join(cwd,'report.html'),'utf8'),/示例项目周报/);
  assert.equal([...prompts].reverse().find(p=>p.name.endsWith('render_report')).args.output_path,join(cwd,'report.html'));
  assert.equal(JSON.parse(await call('mcp__report-renderer__render_report',{ir_content:ir,output_path:'report.html'})).success,true);
  const secret=join(privateRoot,'other-bot.html');writeFileSync(secret,'PRIVATE_CANARY');
  assert.match(await call('mcp__report-renderer__render_report',{ir_content:ir,output_path:secret}),/harness_private_path_denied/);assert.equal(readFileSync(secret,'utf8'),'PRIVATE_CANARY');
  if(existsSync(join(creatorPluginRoot(),'kai-slide-creator'))){
   assert.ok(resources.skills.some((s:any)=>s.name==='slide-planner'));assert.match(await call('skill',{name:'slide-planner'}),/brief_json/);
   const context=JSON.parse(await call('mcp__slide-renderer__get_model_context',{preset:'Swiss Modern'})),brief=context.brief_skeleton;
   Object.assign(brief,{brief_id:'fictional-kteam-test',title:'示例团队验证结果',audience:'测试团队',desired_action:'核对虚构示例',notes:'所有数据均为虚构测试数据'});brief.style.tone='简明';brief.content.must_include=['所有数据均为虚构测试数据'];brief.content.must_avoid=['不得编造真实业务数据'];brief.narrative.thesis='示例团队通过五个步骤完成验证。';
   const roles=['cover','problem','solution','evidence','closing'];brief.narrative.page_roles=roles;brief.narrative.slides=roles.map((role,i)=>({slide_number:i+1,role,title:['示例团队完成初步验证','明确输入让目标更清楚','复用工具减少重复工作','三项检查确认输出有效','下一步核对最终文件'][i],key_point:'所有数据均为虚构测试数据',visual:'statement',claim:'示例步骤 '+(i+1)+' 已完成',explanation:'只用于测试渲染和交付链路。',visual_intent:'statement'}));
   const brief_json=JSON.stringify(brief),validation=JSON.parse(await call('mcp__slide-renderer__validate_brief',{brief_json}));assert.equal(validation.valid,true,JSON.stringify(validation));
   const bad=await call('mcp__slide-renderer__render_slide',{brief_json,output_path:'must-not-exist.html',requested_preset:'Data Story'});assert.match(bad,/mismatch|requested|preset/i);assert.equal(existsSync(join(cwd,'must-not-exist.html')),false);
   await call('mcp__slide-renderer__render_slide',{brief_json,output_path:'slides.html',requested_preset:'Swiss Modern'});assert.equal(existsSync(join(cwd,'slides.html')),true);assert.match(readFileSync(join(cwd,'slides.html'),'utf8'),/示例团队完成初步验证/);
   assert.match(await call('mcp__slide-renderer__render_slide',{brief_json,output_path:secret}),/harness_private_path_denied/);
  }
  const receipts=events.filter(e=>e.file);assert.ok(receipts.length>=2);assert.ok(receipts.every(e=>e.file.sha256&&e.file.roomId==='creator-room'&&e.state==='completed'));
  current=false;await assert.rejects(call('mcp__report-renderer__render_report',{ir_content:ir,output_path:'revoked.html'}),/creator_revoked/);assert.equal(existsSync(join(cwd,'revoked.html')),false);current=true;
  await owner.close();owner=undefined;
  for(const pid of records.filter(r=>r.state==='running').map(r=>r.pid))assert.throws(()=>process.kill(pid,0));
  owner=await open();assert.match(await owner.registry.executeTool('mcp__report-renderer__list_themes',{}),/minimal/);
  assert.deepEqual((await import('node:fs')).readdirSync(cwd).sort(),existsSync(join(creatorPluginRoot(),'kai-slide-creator'))?['report.html','slides.html']:['report.html']);
 }finally{await owner?.close();if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;rmSync(root,{recursive:true,force:true});}
});
