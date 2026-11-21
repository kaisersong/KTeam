import {createHash} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import type {TeamStore} from './team-store.js';
import type {InstalledPlugin,PluginManifest,PluginPreview,PluginRegistryView} from '../protocol/plugins.js';

const key = 'desktop-plugins:v1';
const identifier = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;

function pluginId(value: unknown){
  const id = text(value,'plugin_id',64);
  if(!identifier.test(id))throw new KTeamError('invalid_plugin_id');
  return id;
}

function parseManifest(manifest: unknown): PluginManifest {
  const input = record(manifest);
  fields(input,['manifestVersion','id','name','version','description','contributes']);
  if(input.manifestVersion!==1)throw new KTeamError('plugin_manifest_version');
  const version=text(input.version,'plugin_version',20);
  if(!versionPattern.test(version))throw new KTeamError('invalid_plugin_version');
  const contributions=record(input.contributes);
  fields(contributions,['commands']);
  if(!Array.isArray(contributions.commands)||!contributions.commands.length||contributions.commands.length>16)
    throw new KTeamError('invalid_plugin_commands');
  const ids=new Set<string>();
  const commands=contributions.commands.map(value=>{
    const command=record(value);
    fields(command,['id','title','draft']);
    const id=pluginId(command.id);
    if(ids.has(id))throw new KTeamError('plugin_command_duplicate');
    ids.add(id);
    const draft=text(command.draft,'plugin_draft',4096).trim();
    if(draft.startsWith('/')||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(draft))
      throw new KTeamError('invalid_plugin_draft');
    return {id,title:text(command.title,'plugin_command_title',100).trim(),draft};
  });
  return {
    manifestVersion:1,id:pluginId(input.id),name:text(input.name,'plugin_name',80).trim(),version,
    ...(input.description===undefined?{}:{description:text(input.description,'plugin_description',300).trim()}),
    contributes:{commands},
  };
}

const digest=(manifest:PluginManifest)=>createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

function compareVersions(a:string,b:string){
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  return left[0]!-right[0]!||left[1]!-right[1]!||left[2]!-right[2]!;
}

export class Plugins {
  constructor(private store:TeamStore){}

  list(): PluginRegistryView {
    const saved=this.store.state<Omit<PluginRegistryView,'ok'>>(key);
    return {ok:true,revision:saved?.revision??0,plugins:saved?.plugins??[]};
  }

  preview(value:unknown): PluginPreview {
    const input=record(value);
    fields(input,['manifest']);
    const manifest=parseManifest(input.manifest);
    return {ok:true,revision:this.list().revision,manifest,digest:digest(manifest)};
  }

  install(value:unknown){
    const input=record(value);
    fields(input,['manifest','expectedRevision','expectedDigest']);
    const manifest=parseManifest(input.manifest), hash=digest(manifest);
    if(input.expectedDigest!==hash)throw new KTeamError('plugin_preview_changed',409);
    return this.store.transaction(()=>{
      const prior=this.list(), installed=prior.plugins.find(plugin=>plugin.manifest.id===manifest.id);
      if(installed?.digest===hash)return prior;
      this.checkRevision(prior,input.expectedRevision);
      if(installed&&compareVersions(manifest.version,installed.manifest.version)<=0)
        throw new KTeamError('plugin_version_not_newer',409);
      if(!installed&&prior.plugins.length>=32)throw new KTeamError('plugin_limit',409);
      const next={manifest,digest:hash,enabled:false,revision:prior.revision+1};
      return this.save(prior,[...prior.plugins.filter(item=>item!==installed),next]);
    });
  }

  change(value:unknown){
    const input=record(value);
    fields(input,['id','action','expectedRevision']);
    const id=pluginId(input.id), action=input.action;
    if(action!=='enable'&&action!=='disable'&&action!=='remove')throw new KTeamError('invalid_plugin_action');
    return this.store.transaction(()=>{
      const prior=this.list();
      this.checkRevision(prior,input.expectedRevision);
      const installed=prior.plugins.find(plugin=>plugin.manifest.id===id);
      if(!installed)throw new KTeamError('plugin_not_found',404);
      if(action==='remove')return this.save(prior,prior.plugins.filter(plugin=>plugin!==installed));
      const enabled=action==='enable';
      if(installed.enabled===enabled)return prior;
      return this.save(prior,prior.plugins.map(plugin=>plugin===installed?{...plugin,enabled,revision:prior.revision+1}:plugin));
    });
  }

  commands(){
    return {ok:true,commands:this.list().plugins.filter(plugin=>plugin.enabled).flatMap(plugin=>
      plugin.manifest.contributes.commands.map(command=>({
        pluginId:plugin.manifest.id,pluginName:plugin.manifest.name,commandId:command.id,
        title:command.title,revision:plugin.revision,
      })))};
  }

  draft(value:unknown){
    const input=record(value);
    fields(input,['pluginId','commandId','revision']);
    const id=pluginId(input.pluginId), commandId=pluginId(input.commandId);
    const plugin=this.list().plugins.find(item=>item.manifest.id===id);
    if(!plugin?.enabled||plugin.revision!==input.revision)throw new KTeamError('plugin_changed',409);
    const command=plugin.manifest.contributes.commands.find(item=>item.id===commandId);
    if(!command)throw new KTeamError('plugin_not_found',404);
    return {ok:true,draft:command.draft};
  }

  private checkRevision(prior:PluginRegistryView, expected:unknown){
    if(prior.revision!==expected)throw new KTeamError('plugin_changed',409);
  }

  private save(prior:PluginRegistryView,plugins:InstalledPlugin[]):PluginRegistryView{
    const state={revision:prior.revision+1,plugins};
    if(Buffer.byteLength(JSON.stringify(state))>512*1024)throw new KTeamError('plugin_limit',409);
    this.store.setState(key,state);
    return {ok:true,...state};
  }
}
