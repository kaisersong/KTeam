import {realpathSync, statSync} from 'node:fs';
import {isAbsolute, parse, relative, sep} from 'node:path';
import {KTeamError, fields, record, text} from '../errors.js';
import type {TeamStore} from './team-store.js';

export interface CodexWriteGrant {revision: number; path: string | null; device?: string; inode?: string}
export interface CodexDispatch {botId: string; bindingRevision: number; allowWrite: boolean; grantRevision: number; path: string | null}
const grantKey = (botId: string) => 'codex-write-grant:'+botId;

export function codexDirectory(path: string) {
 if (!isAbsolute(path)||/[\u0000-\u001f]/.test(path)) throw new KTeamError('codex_write_directory_invalid', 409);
 try {
  const canonical = realpathSync.native(path), stat = statSync(canonical, {bigint:true});
  if (!stat.isDirectory() || canonical === parse(canonical).root || /[\u0000-\u001f]/.test(canonical)) throw Error('invalid directory');
  return {path:canonical,device:String(stat.dev),inode:String(stat.ino)};
 } catch { throw new KTeamError('codex_write_directory_invalid', 409); }
}

export function directoryContains(root: string, path: string) {
 const fromRoot = relative(root,path);
 return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith('..'+sep));
}

export function codexWriteGrant(store: TeamStore, botId: string): CodexWriteGrant {
 return store.state<CodexWriteGrant>(grantKey(botId)) ?? {revision:0,path:null};
}

export function assertCodexBinding(store: TeamStore, botId: string) {
 const binding = store.binding(botId);
 if (binding?.kind !== 'local-native' || binding.modelId !== 'local-agent:codex') throw new KTeamError('codex_member_required',409);
 return binding;
}

export function saveCodexWriteGrant(store: TeamStore, value: unknown) {
 const input = record(value);
 fields(input,['botId','path','expectedRevision']);
 const botId = text(input.botId,'bot_id');
 assertCodexBinding(store,botId);
 const prior = codexWriteGrant(store,botId);
 if (prior.revision !== input.expectedRevision) throw new KTeamError('codex_write_grant_changed',409);
 const directory = input.path === null ? {path:null} : codexDirectory(text(input.path,'directory',4096));
 if (directory.path && (directoryContains(directory.path,store.root)||directoryContains(store.root,directory.path))) throw new KTeamError('codex_write_directory_invalid',409);
 const grant = {revision:prior.revision+1,...directory};
 store.setState(grantKey(botId),grant);
 return grant;
}

export function currentCodexWriteRoot(store: TeamStore, dispatch: CodexDispatch) {
 const grant = codexWriteGrant(store,dispatch.botId);
 if (assertCodexBinding(store,dispatch.botId).revision !== dispatch.bindingRevision || grant.revision !== dispatch.grantRevision) throw new KTeamError('codex_write_grant_changed',409);
 if (!grant.path) throw new KTeamError('codex_write_grant_required',409);
 const identity = codexDirectory(grant.path);
 if (identity.path !== grant.path || identity.device !== grant.device || identity.inode !== grant.inode) throw new KTeamError('codex_write_grant_changed',409);
 return grant.path;
}
