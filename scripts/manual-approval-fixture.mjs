// Test-only loopback stand-in. It is not a real model and it cannot grant an
// approval. A normal read is auto-allowed, and a sensitive read is denied, so
// neither creates a pending card. This stand-in asks for one cat of a temporary
// .pem file, which the existing policy does not auto-allow.
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const FIXTURE_FILE_NAME='fixture-note.pem';
export const FIXTURE_TEXT='KTEAM_FIXTURE_NOT_A_SECRET\n';
export const FIXTURE_MODEL_ID='fixture-not-a-real-model';
export const FIXTURE_LABEL='测试夹具（不是真实模型）';

export function fixtureCommand(file){return 'cat '+file;}
function canonical(path){return realpathSync.native(path);}
function underTemp(path){
  const root=canonical(tmpdir()),target=canonical(path);
  const same=process.platform==='win32'?(left,right)=>left.toLowerCase()===right.toLowerCase():(left,right)=>left===right;
  const inside=process.platform==='win32'?(dir,child)=>child.toLowerCase().startsWith(dir.toLowerCase()+sep): (dir,child)=>child.startsWith(dir+sep);
  if(!same(target,root)&&!inside(root,target))throw Object.assign(new Error('fixture_outside_temp'),{code:'fixture_outside_temp'});
  return target;
}
function needsTool(messages){
  const list=Array.isArray(messages)?messages:[];
  let lastUser=-1;
  list.forEach((message,index)=>{if(message&&message.role==='user')lastUser=index;});
  return !list.slice(lastUser+1).some(message=>message&&message.role==='tool');
}

export async function startApprovalFixture(directory){
  const workspace=underTemp(directory);
  mkdirSync(workspace,{recursive:true});
  const file=join(workspace,FIXTURE_FILE_NAME);
  writeFileSync(file,FIXTURE_TEXT,{mode:0o600});
  const command=fixtureCommand(file);
  let requests=0;
  const server=createServer(async(req,res)=>{
    const remote=req.socket.remoteAddress;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')){res.writeHead(403);res.end();return;}
    if(req.method==='GET'&&req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({object:'list',data:[{id:FIXTURE_MODEL_ID,object:'model',owned_by:'kteam-test-fixture'}]}));return;}
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);
    requests+=1;
    const call=needsTool(body.messages);
    const delta=call?{role:'assistant',tool_calls:[{index:0,id:'fixture-cat-'+requests,type:'function',function:{name:'bash',arguments:JSON.stringify({command})}}]}:{role:'assistant',content:'夹具已结束。这不是真实模型的答复。'};
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
    for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:8,completion_tokens:4}}])res.write('data: '+JSON.stringify({id:'approval-fixture',object:'chat.completion.chunk',model:FIXTURE_MODEL_ID,...chunk})+'\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((ok,reject)=>server.once('error',reject).listen(0,'127.0.0.1',ok));
  const port=server.address().port;
  return {workspace,file,command,text:FIXTURE_TEXT,baseUrl:'http://127.0.0.1:'+port+'/v1',requests:()=>requests,close:()=>new Promise(ok=>{server.closeAllConnections();server.close(()=>ok());})};
}

export async function prepareManualFixture(){
  const root=underTemp(mkdtempSync(join(tmpdir(),'kteam-approval-fixture-')));
  const data=join(root,'data'),workspace=join(root,'workspace');
  mkdirSync(data,{mode:0o700});
  const fixture=await startApprovalFixture(workspace);
  const instructions=[
    '这是测试夹具，不是真实模型。它只监听 127.0.0.1，不能批准操作。',
    '普通 read 会直接放行，敏感文件名的 read 会直接拒绝，都不会出现待决卡片。',
    '夹具让模型执行 cat，目标是临时目录里的 '+FIXTURE_FILE_NAME+'。现有策略不自动放行这条命令。',
    '先退出已经打开的 KTeam。不要把 KTEAM_DATA_DIR 指到已有数据目录。',
    '',
    '1. 在仓库根目录执行：',
    'KTEAM_DATA_DIR='+JSON.stringify(data)+' ./node_modules/.bin/electron .',
    '2. 设置 → 模型设置 → 添加模型。名称填「'+FIXTURE_LABEL+'」。接口类型选 OpenAI 兼容 Chat。',
    '   接口地址：'+fixture.baseUrl,
    '   模型名称 / ID：'+FIXTURE_MODEL_ID,
    '   API Key 留空。勾选作为默认模型并保存。不要点「从小K导入」。',
    '3. 用这个默认模型创建 Bot，工作目录设为：',
    fixture.workspace,
    '4. 在该会话发送任意一句话。待决卡片由真实 Harness 生成。',
    '5. 允许一次后，'+fixture.file+' 的内容仍应是 '+FIXTURE_TEXT.trim()+'。',
    '6. 再发一句。待决出现后，在会话工作区暂停。手机上的「停止当前工作」调用同一次暂停，待决会被取消。',
    '7. 设置 → 手机连接完成配对后，在「已连接手机」里撤销连接。撤销后这部手机不能再提交允许或拒绝。',
    '',
    '按 Ctrl+C 结束夹具。它不会关闭桌面，也不会删除已有数据。',
  ].join('\n');
  return {...fixture,data,instructions,async close(){await fixture.close();}};
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked){
  const session=await prepareManualFixture();
  process.stdout.write(session.instructions+'\n');
  const stop=()=>{void session.close().then(()=>process.exit(0));};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
