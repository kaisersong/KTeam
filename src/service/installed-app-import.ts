import {existsSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {KTeamError,record} from '../errors.js';
import {privateRead} from './config.js';

/*
 * User-initiated, read-only model import from an installed xiaok (「从小K导入」 in model settings).
 * This is the only KTeam module that may touch xiaok's files or keychain entry, and it runs only from
 * ModelSettings.importXiaok, whose route is reached only from that button. Nothing at startup, in the background or on
 * config load calls it. It never writes, chmods, renames, locks or creates anything in xiaok's home directory or in
 * xiaok's keychain entry: every access is lstat/realpath/read, and the keychain is only ever asked for a value.
 * tests/decoupling.test.ts allows exactly the two declaration lines below and nothing else anywhere. (The file is
 * named without "xiaok" because that guard also forbids xiaok in any import specifier.)
 */
const xiaokConfigFile=()=>join(homedir(),'.xiaok','config.json');
const xiaokKeychainService='com.xiaok.credentials.v1';

/** Read-only view of a keychain: KTeam can ask xiaok's entry for a value, never store one. */
export interface XiaokKeychain{get(service:string,id:string):string|null}
const require=createRequire(typeof __filename==='string'?__filename:import.meta.url);
/** The OS keychain. Replaceable only so tests can observe that nothing but the import asks it. */
export const systemXiaokKeychain:XiaokKeychain={get(service,id){const {Entry}=require('@napi-rs/keyring');return new Entry(service,id,{linux:{store:'secret-service'}}).getPassword();}};
const RESERVED=['__proto__','prototype','constructor','$xiaokCredentials'];

/**
 * Reads xiaok's model settings and the credentials they reference, once, and returns them normalized.
 * Throws before returning anything if any read fails, so the caller writes KTeam's config and credentials
 * only after every read succeeded (no partial import). A denied keychain prompt stops the import at once
 * with `xiaok_keychain_denied`; it is never retried here, only a new click asks again.
 */
export function readXiaokModels(core:{normalizeConfig(value:unknown):any;isSensitiveCredentialPath(path:string[]):boolean},keychain:XiaokKeychain=systemXiaokKeychain){
 const source=xiaokConfigFile();
 if(!existsSync(source))throw new KTeamError('xiaok_import_source_missing',404);
 if(lstatSync(source).isSymbolicLink())throw new KTeamError('private_file_required');
 const sourceRoot=realpathSync(dirname(source)),canonical=join(sourceRoot,'config.json');
 let raw:Record<string,any>;try{raw=record(JSON.parse(privateRead(source)));}catch(error){if(error instanceof KTeamError)throw error;throw new KTeamError('model_import_schema_unsupported');}
 if(raw.schemaVersion!==2)throw new KTeamError('model_import_schema_unsupported');
 const refs=raw.$xiaokCredentials as any;delete raw.$xiaokCredentials;
 if(refs!==undefined){
  if(refs?.version!==1||!Array.isArray(refs.entries)||refs.entries.length>256)throw new KTeamError('credential_binding_invalid');
  const vaultFile=join(sourceRoot,'credentials','store.json');let vault:Record<string,unknown>|undefined;
  const values=()=>{vault??=existsSync(vaultFile)?record(JSON.parse(privateRead(vaultFile))):{version:1,backend:'file',entries:{}};if(vault.version!==1||!['file','keychain'].includes(String(vault.backend)))throw new KTeamError('credential_config_corrupt');return vault;};
  const owner=createHash('sha256').update(canonical).digest('hex');
  for(const item of refs.entries){
   if(!Array.isArray(item?.path)||!item.path.length||item.path.some((part:unknown)=>typeof part!=='string'||RESERVED.includes(part as string))||!core.isSensitiveCredentialPath(item.path)||typeof item.ref!=='string'||!/^xiaok-secret:v1:[a-f0-9-]{36}$/.test(item.ref))throw new KTeamError('credential_binding_invalid');
   if(!['providers','systemOne'].includes(item.path[0]))continue;
   const id=item.ref.slice('xiaok-secret:v1:'.length),store=values(),stored=store.backend==='file'?record(store.entries??{})[id]:undefined;
   let encoded:unknown=stored;
   if(encoded===undefined){try{encoded=keychain.get(xiaokKeychainService,id);}catch{throw new KTeamError('xiaok_keychain_denied',403);}}
   if(encoded===null||typeof encoded!=='string')throw new KTeamError('credential_missing');
   let bound:any;try{bound=JSON.parse(encoded);}catch{throw new KTeamError('credential_binding_invalid');}
   if(bound?.owner!==owner||JSON.stringify(bound.path)!==JSON.stringify(item.path)||typeof bound.value!=='string')throw new KTeamError('credential_binding_invalid');
   let node=raw;for(const part of item.path.slice(0,-1)){if(!node[part]||typeof node[part]!=='object')node[part]={};node=node[part];}node[item.path.at(-1)]=bound.value;
  }
 }
 return core.normalizeConfig(raw);
}
