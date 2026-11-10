import {KTeamError,fields,record} from '../errors.js';
import type {TeamStore} from './team-store.js';

export interface AppPreferences {
 revision:number; theme:'system'|'light'|'dark'; fontSize:13|14|16;
 density:'comfortable'|'compact'; sendShortcut:'enter'|'modifier-enter'; disabledSkills:string[];
}
export const DEFAULT_PREFERENCES:AppPreferences={revision:0,theme:'system',fontSize:14,density:'comfortable',sendShortcut:'enter',disabledSkills:[]};
export function appPreferences(store:TeamStore):AppPreferences{return {...DEFAULT_PREFERENCES,...store.state<AppPreferences>('app-preferences')};}
export function saveAppPreferences(store:TeamStore,value:unknown):AppPreferences {
 const input=record(value);fields(input,['expectedRevision','theme','fontSize','density','sendShortcut','disabledSkills']);
 const current=appPreferences(store);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current.revision)throw new KTeamError('app_settings_changed',409);
 if(input.theme!==undefined&&(typeof input.theme!=='string'||!['system','light','dark'].includes(input.theme))||input.fontSize!==undefined&&![13,14,16].includes(Number(input.fontSize))||input.density!==undefined&&(typeof input.density!=='string'||!['comfortable','compact'].includes(input.density))||input.sendShortcut!==undefined&&(typeof input.sendShortcut!=='string'||!['enter','modifier-enter'].includes(input.sendShortcut)))throw new KTeamError('invalid_app_settings');
 if(input.fontSize!==undefined&&typeof input.fontSize!=='number')throw new KTeamError('invalid_app_settings');
 if(input.disabledSkills!==undefined&&(!Array.isArray(input.disabledSkills)||input.disabledSkills.length>1000||input.disabledSkills.some(v=>typeof v!=='string'||!v||v.length>256)||new Set(input.disabledSkills).size!==input.disabledSkills.length))throw new KTeamError('invalid_app_settings');
 const {expectedRevision,...patch}=input;
 const next={...current,...patch,revision:current.revision+1} as AppPreferences;
 store.setState('app-preferences',next);return next;
}
