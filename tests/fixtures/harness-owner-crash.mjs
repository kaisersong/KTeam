import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const {createHarness}=await import(pathToFileURL(resolve('dist/src/runtime/harness.js')).href);
const root=process.env.KTEAM_TEST_ROOT,records=[];
const h=await createHarness({scope:{root:join(root,'host-data'),botId:'crash-bot',roomId:'crash-room',bindingRevision:1,fingerprint:'fixture',profileRevision:1},workspace:join(root,'project'),signal:new AbortController().signal,assertCurrent:async()=>{},onPrompt:async()=>true,onProcess:record=>{records.push(record);writeFileSync(join(root,'resources.json'),JSON.stringify(records));}});
await h.prepare({getModelName:()=> 'fixture'},'fixture','test',[]);
process.send?.({ready:true,records});setInterval(()=>{},1000);
