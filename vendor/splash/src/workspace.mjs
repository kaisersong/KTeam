// Verification UI only. Never embeds user HTML in the management origin.
export const workspaceHTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Space · 创作空间</title><style>
body{margin:0;background:#f5f7fa;color:#172536;font:15px system-ui}main{max-width:1040px;margin:48px auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}h1{margin:0;font-size:28px}.badge{color:#8b5100;background:#fff2d9;padding:6px 12px;border-radius:20px}section{background:white;border:1px solid #dce3eb;border-radius:12px;padding:24px;margin:20px 0}label{display:block;margin:12px 0}input,select,button{font:inherit;padding:10px;border:1px solid #b8c4d2;border-radius:6px}button{cursor:pointer;background:#173c63;color:white;margin:4px}button:disabled{opacity:.45;cursor:default}.muted{color:#637184;line-height:1.7}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}#message{white-space:pre-wrap;line-height:1.7}#pending{border-color:#cd9e4e}ul{line-height:1.9}a{color:#15559b}details{margin:12px 0}@media(max-width:600px){main{margin:8px auto}header{align-items:flex-start;gap:12px}section{padding:16px}input,select{max-width:100%}}
</style><main><header><div><h1>创作空间</h1><p class="muted">从网页目录到可预览的作品。</p></div><span class="badge">本机验证 · 非公网分享</span></header>
<p class="muted">当前只在这台电脑提供预览。CloudBase 管理密钥不会交给页面；正式公网发布仍需完成账号、域名和费用防护配置。</p>
<section><h2>新建空间</h2><form id="createForm" class="row"><input id="title" aria-label="空间名称" maxlength="100" required placeholder="例如 产品介绍"><button id="create" type="submit">创建空间</button></form></section>
<section><div class="row"><h2>我的空间</h2><button id="refresh" type="button">刷新</button></div><select id="spaces" aria-label="选择空间"></select><p id="summary" class="muted"></p>
<label>选择构建好的网页目录（含 index.html）<input id="folder" type="file" webkitdirectory multiple></label><p id="files" class="muted">最多 64 个文件、合计 1 MiB。选择后会列出将上传的文件，点击上传才会传输。</p><details><summary>查看所选文件</summary><ul id="fileList"></ul></details>
<div class="row"><button id="upload">上传为草稿</button><button id="publish">发布当前草稿</button><button id="preview">打开本机预览</button><button id="copy">复制本机链接</button><button id="unpublish">下架</button></div>
<label>回滚到已发布版本<select id="releases" aria-label="回滚版本"></select></label><button id="rollback">回滚</button><p id="quota" class="muted"></p></section>
<section id="pending" hidden><h2>有一个操作需要核对</h2><p id="pendingText"></p><div class="row"><button id="reconcile">只读核对</button><button id="retry">重试原请求</button><button id="abandon">放弃这条待核对记录</button></div><p class="muted">核对不会自动重放写操作。放弃记录不会撤销已经发生的操作；页面刷新后若已丢失上传内容，需要重新选择原目录。</p></section>
<p id="message" role="status"></p></main><script src="/space/app.js"></script></html>`;

export const workspaceJS = String.raw`'use strict';
const el=id=>document.getElementById(id);
const fragment=new URLSearchParams(location.hash.slice(1));
// This is a local session bearer, never a CloudBase key. It expires with the owned runtime.
const token=fragment.get('token')||sessionStorage.getItem('splash-session');
if(fragment.get('token'))sessionStorage.setItem('splash-session',token);
history.replaceState(null,'','/space');
let spaces=[],detail=null,selectedFiles=[],busy=false,payload=null;
let pending=null;try{pending=JSON.parse(sessionStorage.getItem('splash-pending')||'null');}catch{sessionStorage.removeItem('splash-pending');}
function say(text){el('message').textContent=text;}
function savePending(){if(pending)sessionStorage.setItem('splash-pending',JSON.stringify(pending));else sessionStorage.removeItem('splash-pending');render();}
function render(){
 for(const id of ['create','upload','publish','unpublish','rollback'])el(id).disabled=busy||!!pending;
 el('upload').disabled ||= !detail||!selectedFiles.length;
 el('publish').disabled ||= !detail||!detail.draftVersionId;
 el('unpublish').disabled ||= !detail||detail.status!=='published';
 el('rollback').disabled ||= !detail||!detail.releases.length;
 for(const id of ['refresh','spaces','preview','copy'])el(id).disabled=busy;
 el('preview').disabled ||= !detail||!detail.shareUrl;el('copy').disabled ||= !detail||!detail.shareUrl;
 el('pending').hidden=!pending;el('pendingText').textContent=pending?'原操作：'+pending.kind+'，请求编号：'+pending.key:'';
 el('retry').disabled=busy||!pending;el('reconcile').disabled=busy||!pending;el('abandon').disabled=busy;
 el('folder').disabled=busy||!detail||!!pending&&pending.kind!=='upload';
 el('summary').textContent=detail?detail.title+' · '+detail.status+' · revision '+detail.revision:'先创建或选择一个空间';
}
async function api(path,{method='GET',data,key}={}){
 if(!token)throw Error('登录凭证缺失，请回到 KTeam 再输入 /space 打开。');
 const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const value=await r.json();if(!r.ok){const e=Error(value.error||'请求失败');e.status=r.status;throw e;}return value;
}
async function read(selectedId){
 const chosen=selectedId||pending&&pending.spaceId||el('spaces').value;
 const result=await Promise.all([api('/v1/spaces'),api('/v1/quota')]);spaces=result[0];
 el('spaces').replaceChildren(...spaces.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.title;return o;}));
 if(spaces.some(s=>s.id===chosen))el('spaces').value=chosen;
 detail=el('spaces').value?await api('/v1/spaces/'+el('spaces').value):null;
 el('releases').replaceChildren(...(detail?detail.releases:[]).slice().reverse().map(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.createdAt+' · '+r.versionId.slice(0,8);return o;}));
 const q=result[1];el('quota').textContent='素材：'+q.stored+' / '+q.storageLimit+' 字节；待核对存储：'+q.storageReserved+' 字节；正文流量：'+q.used+' / '+q.byteLimit+' 字节；待结算：'+q.reserved+' 字节；访问：'+q.requests+' / '+q.requestLimit+' 次（原型累计额度）';render();
}
async function reading(){if(busy)return;busy=true;render();try{await read();}catch(e){say(e.message);}finally{busy=false;render();}}
function clearPending(){pending=null;payload=null;savePending();}
async function perform(){
 if(busy||!pending)return;
 if(payload===null){say('原请求内容不在内存中。请先只读核对；原上传尚未完成时可重新选择同一目录后重试。');return;}
 busy=true;render();
 try{
  const r=await api(pending.path,{method:'POST',data:payload,key:pending.key});
  const created=pending.kind==='create'?r.id:undefined;
  clearPending();say('操作已确认完成。');await read(created);
 }catch(e){say('操作未确认：'+e.message+'。已保留原请求编号，请先核对，不会自动再次执行。');}
 finally{busy=false;render();}
}
function begin(kind,path,data){if(busy||pending)return;pending={kind,path,key:crypto.randomUUID(),spaceId:kind==='create'?null:detail&&detail.id,expectedRevision:data.expectedRevision};payload=data;savePending();void perform();}
el('createForm').addEventListener('submit',e=>{e.preventDefault();begin('create','/v1/spaces',{title:el('title').value.trim()});});
el('refresh').addEventListener('click',reading);el('spaces').addEventListener('change',()=>{selectedFiles=[];el('folder').value='';el('fileList').replaceChildren();void reading();});
el('folder').addEventListener('change',()=>{
 selectedFiles=Array.from(el('folder').files).filter(f=>!f.webkitRelativePath.split('/').some(x=>x.startsWith('.')||x==='node_modules'));
 const total=selectedFiles.reduce((n,f)=>n+f.size,0);
 el('fileList').replaceChildren(...selectedFiles.map(f=>{const li=document.createElement('li');li.textContent=f.webkitRelativePath+' · '+f.size+' 字节';return li;}));
 el('files').textContent='选中 '+selectedFiles.length+' 个文件，'+total+' 字节。隐藏项和 node_modules 不上传。';
 if(selectedFiles.length>64||total>1048576){say('目录超过验证上限，请只选择构建产物目录。');selectedFiles=[];}render();
});
async function packageFiles(){return {entry:'index.html',files:await Promise.all(selectedFiles.map(async file=>{const b=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return {path:file.webkitRelativePath.split('/').slice(1).join('/')||file.name,base64:btoa(s)};})),expectedRevision:pending?pending.expectedRevision:detail.revision};}
el('upload').addEventListener('click',()=>{if(busy||pending||!detail)return;busy=true;render();void packageFiles().then(data=>{busy=false;begin('upload','/v1/spaces/'+detail.id+'/versions',data);}).catch(e=>{busy=false;say(e.message);render();});});
el('publish').addEventListener('click',()=>begin('publish','/v1/spaces/'+detail.id+'/publish',{versionId:detail.draftVersionId,expectedRevision:detail.revision}));
el('unpublish').addEventListener('click',()=>{if(confirm('下架后本机链接将不能访问，确认下架？'))begin('unpublish','/v1/spaces/'+detail.id+'/unpublish',{expectedRevision:detail.revision});});
el('rollback').addEventListener('click',()=>{if(confirm('确认回滚到所选发布版本？'))begin('rollback','/v1/spaces/'+detail.id+'/rollback',{releaseId:el('releases').value,expectedRevision:detail.revision});});
function previewURL(){const u=new URL(detail.shareUrl);if(u.protocol!=='http:'||!u.hostname.endsWith('.spaces.localhost')||u.username||u.password||u.hash||u.search)throw Error('预览地址不符合本机验证范围');return u.href;}
el('preview').addEventListener('click',()=>{try{window.open(previewURL(),'_blank','noopener,noreferrer');}catch(e){say(e.message);}});
el('copy').addEventListener('click',()=>{void navigator.clipboard.writeText(previewURL()).then(()=>say('本机链接已复制，其他电脑不能访问。')).catch(()=>say('复制失败，请使用打开预览。'));});
el('reconcile').addEventListener('click',async()=>{
 if(busy||!pending)return;busy=true;render();
 try{const query=new URLSearchParams({kind:pending.kind,spaceId:pending.spaceId||'',key:pending.key});const result=await api('/v1/operations?'+query);
  if(result.status==='complete'){clearPending();say('只读核对确认原操作已完成。');await read(result.spaceId);}
  else say('原操作仍未确认（'+result.status+'）。不会自动重放；请稍后核对或显式重试原请求。');
 }catch(e){say('核对失败：'+e.message);}finally{busy=false;render();}
});
el('retry').addEventListener('click',()=>{if(pending&&pending.kind==='upload'&&selectedFiles.length&&!payload){busy=true;render();void packageFiles().then(data=>{payload=data;busy=false;return perform();}).catch(e=>{busy=false;say(e.message);render();});}else void perform();});
el('abandon').addEventListener('click',()=>{if(confirm('这只丢弃本页记录，不会取消已经发生的操作。确认后请核对空间列表再发起新操作。')){clearPending();say('记录已放弃，未发送任何撤销或重试请求。');void reading();}});
render();void reading();`;
