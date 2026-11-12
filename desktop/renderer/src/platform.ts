/** The desktop client's OS, read from the renderer's own navigator (no extra IPC surface). */
export type ClientPlatform='windows'|'mac'|'other';
type NavigatorLike={userAgent?:string;platform?:string;userAgentData?:{platform?:string}};
export function clientPlatform(nav:NavigatorLike|undefined=(globalThis as {navigator?:NavigatorLike}).navigator):ClientPlatform{
 const value=[nav?.userAgentData?.platform,nav?.platform,nav?.userAgent].filter(Boolean).join(' ');
 if(/windows|win32|win64/i.test(value))return 'windows';
 if(/mac/i.test(value))return 'mac';
 return 'other';
}
/** Message read-aloud uses the macOS `say` voice; Windows has no KTeam speech backend in 0.4. */
export const speechSupported=(nav?:NavigatorLike)=>clientPlatform(nav)!=='windows';
