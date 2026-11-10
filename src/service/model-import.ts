import {parse} from 'smol-toml';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {KTeamError,record} from '../errors.js';
const paths=(home:string)=>({kimi:[join(home,'.kimi-code','config.toml'),join(home,'.kimi','config.toml')],zcode:[join(home,'.zcode','settings.json'),join(home,'.zcode','config.json')],deepseek:[join(home,'Library','Application Support','deepseek-gui','deepseek-gui-settings.json')]});
export const modelImportSources=()=>Object.entries(paths(homedir())).map(([id,files])=>({id,available:files.some(existsSync)}));
/** Parse exported API configuration only. OAuth sessions and shell substitutions are never evaluated. */
export function parseModelImport(content:string){if(content.length>1024*1024)throw new KTeamError('model_import_too_large');let config:any;try{config=record(content.trim().startsWith('{')?JSON.parse(content):parse(content));}catch{throw new KTeamError('model_import_schema_unsupported');}const models:any[]=[],skipped:string[]=[];
 const add=(id:string,m:any,p:any)=>{if(!p||typeof p!=='object'||!m||typeof m!=='object')return;const apiKey=p.api_key??p.apiKey??p.api_key_value,baseUrl=p.base_url??p.baseUrl??p.apiEndpoint,wire=m.model??m.id??id;if(p.oauth||p.auth?.type==='oauth'||p.apiKeyHelper||p.env_key){skipped.push('oauth_or_external_credential');return;}if(typeof wire!=='string'||typeof baseUrl!=='string')return;if(apiKey!==undefined&&typeof apiKey!=='string')throw new KTeamError('model_import_schema_unsupported');const protocol=p.protocol??(p.type==='anthropic'?'anthropic':p.wire_api==='responses'?'openai_responses':'openai_legacy');if(!['anthropic','openai_legacy','openai_responses'].includes(protocol))return;models.push({id,label:m.label??m.display_name??m.name??wire,model:wire,baseUrl,apiKey,protocol});};
 if(Array.isArray(config.provider?.providers)){for(const p of config.provider.providers)for(const m of p.models??[])add(typeof m==='string'?m:m.id,typeof m==='string'?{model:m}:m,p);}
 else if(config.providers&&config.models){for(const [id,m]of Object.entries(config.models))add(id,m,config.providers[(m as any)?.provider]);}
 else if(Array.isArray(config.models)){for(const m of config.models)add(m.id??m.model,m,m);}
 else if(config.model&&typeof config.model==='string'){const p=config.model_providers?.[config.model_provider]??config;add(config.model,{model:config.model},p);}
 else if(config.apiKey||config.api_key){for(const m of config.modelList??[])add(m.id??m.model,m,config);}
 if(models.length>128)throw new KTeamError('model_import_too_large');if(!models.length&&!skipped.length)throw new KTeamError('model_import_schema_unsupported');return {models,skipped};
}
export function readModelImport(source:string,content?:unknown){if(source==='file'){if(typeof content!=='string')throw new KTeamError('model_import_schema_unsupported');return parseModelImport(content);}if(!['kimi','zcode','deepseek'].includes(source))throw new KTeamError('model_import_source_invalid');const file=(paths(homedir()) as any)[source].find(existsSync);if(!file)throw new KTeamError('model_import_source_missing');const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||process.platform!=='win32'&&stat.uid!==process.getuid?.())throw new KTeamError('model_import_source_unsafe');return parseModelImport(readFileSync(file,'utf8'));}
