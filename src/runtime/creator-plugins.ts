import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

// Resolve beside the shared runtime, including app.asar.unpacked/build/shared.
// Never depend on a sibling checkout or the Desktop process working directory.
export function creatorPluginRoot(){return resolve(dirname(process.env.KTEAM_RUNTIME_ENTRY??resolve('build/shared/kteam-runtime.mjs')),'../plugins');}
export function creatorSkillRoots(){return ['kai-report-creator','kai-slide-creator'].map(name=>join(creatorPluginRoot(),name,'skills')).filter(existsSync);}
export function bindCreatorPlugin(plugin:any){
 if(!['kai-report-creator','kai-slide-creator'].includes(plugin.name)||resolve(plugin.rootDir)!==join(creatorPluginRoot(),plugin.name))return plugin;
 return {...plugin,hooks:[],mcpServers:plugin.mcpServers.map((server:any)=>{
  if(plugin.name==='kai-report-creator')return {...server,command:process.execPath,env:{...server.env,ELECTRON_RUN_AS_NODE:'1'}};
  const runtime=JSON.parse(readFileSync(join(plugin.rootDir,'runtime.json'),'utf8'));
  return {...server,command:join(plugin.rootDir,runtime.launcher),args:['-I','-B','-X','utf8','-c',"import runpy,site,sys;site.addsitedir(sys.argv[1]);runpy.run_path(sys.argv[2],run_name='__main__')",join(plugin.rootDir,'python-packages'),join(plugin.rootDir,'mcp-servers/slide-renderer/server.py')]};
 })};
}
