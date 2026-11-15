import {writeFileSync} from 'node:fs';
import {TeamStore} from '../../dist/src/service/team-store.js';
import {ArtifactDelivery} from '../../dist/src/runtime/artifact-delivery.js';
import {Upstreams} from '../../dist/src/adapters/upstream.js';
const input=JSON.parse(process.env.KTEAM_ARTIFACT_CRASH_FIXTURE),store=new TeamStore(input.root),upstream=new Upstreams(input.upstream);
const owner=new ArtifactDelivery(store,input.scope,()=>upstream.aimp(input.scope.roomId,'execution-check',input.admission),update=>upstream.aimp(input.scope.roomId,'effect',{...input.admission,...update}),taskRef=>upstream.aimpEffects(input.scope.roomId,taskRef));
await owner.render('mcp__report-renderer__render_report',{output_path:input.target},async args=>{writeFileSync(args.output_path,'<!doctype html><html><body>Synthetic incomplete attempt</body></html>');process.send?.({stage:'candidate-entered'});await new Promise(()=>setInterval(()=>{},1000));});
