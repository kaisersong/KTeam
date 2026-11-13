import {KTeamError,record,fields} from '../src/errors.js';
const locations:Record<string,string>={
 accessibility:'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
 'screen-recording':'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
 automation:'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
};
/** Main chooses a fixed System Settings pane; renderer cannot supply a URL. */
export function computerPermissionSettingsUrl(value:unknown,platform:NodeJS.Platform=process.platform){
 if(platform!=='darwin')throw new KTeamError('desktop_action_unavailable');
 const input=record(value);fields(input,['permission']);if(typeof input.permission!=='string'||!Object.hasOwn(locations,input.permission))throw new KTeamError('computer_permission_invalid');return locations[input.permission]!;
}
