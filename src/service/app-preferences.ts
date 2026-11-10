import {systemDisplayName} from './user-defaults.js';
import {KTeamError,fields,record} from '../errors.js';
import type {TeamStore} from './team-store.js';
import {validateProfileAvatar} from './profile-avatar.js';

export interface AppPreferences {
 revision:number; theme:'system'|'light'|'dark'; fontSize:13|14|16;
 density:'comfortable'|'compact'; sendShortcut:'enter'|'modifier-enter'; disabledSkills:string[];
 displayName:string; displayNameSource:'system'|'custom'; avatarDataUrl:string;
}
export const DEFAULT_PREFERENCES:AppPreferences={revision:0,theme:'system',fontSize:14,density:'comfortable',sendShortcut:'enter',disabledSkills:[],displayName:systemDisplayName(),displayNameSource:'system',avatarDataUrl:''};
export function appPreferences(store:TeamStore):AppPreferences{const saved=store.state<AppPreferences>('app-preferences'),source=saved?.displayNameSource??(saved?.displayName&&saved.displayName!=='我'?'custom':'system');return {...DEFAULT_PREFERENCES,...saved,displayName:source==='system'?DEFAULT_PREFERENCES.displayName:saved!.displayName,displayNameSource:source};}
export function saveAppPreferences(store:TeamStore,value:unknown):AppPreferences {
 const input={...record(value)};fields(input,['expectedRevision','theme','fontSize','density','sendShortcut','disabledSkills','displayName','avatarDataUrl','useSystemName']);
 const current=appPreferences(store);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current.revision)throw new KTeamError('app_settings_changed',409);
 if(input.theme!==undefined&&(typeof input.theme!=='string'||!['system','light','dark'].includes(input.theme))||input.fontSize!==undefined&&![13,14,16].includes(Number(input.fontSize))||input.density!==undefined&&(typeof input.density!=='string'||!['comfortable','compact'].includes(input.density))||input.sendShortcut!==undefined&&(typeof input.sendShortcut!=='string'||!['enter','modifier-enter'].includes(input.sendShortcut)))throw new KTeamError('invalid_app_settings');
 if(input.fontSize!==undefined&&typeof input.fontSize!=='number')throw new KTeamError('invalid_app_settings');
 if(input.disabledSkills!==undefined&&(!Array.isArray(input.disabledSkills)||input.disabledSkills.length>1000||input.disabledSkills.some(v=>typeof v!=='string'||!v||v.length>256)||new Set(input.disabledSkills).size!==input.disabledSkills.length))throw new KTeamError('invalid_app_settings');
 if(input.useSystemName!==undefined&&input.useSystemName!==true)throw new KTeamError('invalid_profile_name');if(input.useSystemName&&input.displayName!==undefined)throw new KTeamError('invalid_profile_name');
 if(input.displayName!==undefined){if(typeof input.displayName!=='string'||!input.displayName.trim()||Array.from(input.displayName.trim()).length>40||/[\u0000-\u001f\u007f]/.test(input.displayName))throw new KTeamError('invalid_profile_name');input.displayName=input.displayName.trim();}
 if(input.avatarDataUrl!==undefined)input.avatarDataUrl=validateProfileAvatar(input.avatarDataUrl);
 const {expectedRevision,useSystemName,...patch}=input;if(useSystemName){patch.displayName=DEFAULT_PREFERENCES.displayName;patch.displayNameSource='system';}else if(input.displayName!==undefined)patch.displayNameSource='custom';
 const next={...current,...patch,revision:current.revision+1} as AppPreferences;
 store.setState('app-preferences',next);return next;
}
