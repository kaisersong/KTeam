export const ROOM_WORKSPACE_PROTOCOL = 'room_workspace_v1';

/** Pure capability check on a broker/KSwarm handshake. KTeam keeps no on-disk
 * protocol minimum and never reads or writes another application's state. */
export function supportsRoomWorkspaceProtocol(input: unknown): boolean {
  if(!input||typeof input!=='object')return false;
  const value=input as {ok?:boolean;protocols?:Record<string,unknown>};
  if(value.ok===false)return false;
  const protocol=value.protocols?.[ROOM_WORKSPACE_PROTOCOL] as Record<string,unknown>|undefined;
  return protocol?.contextVersion===1&&protocol.resultVersion===1&&protocol.releaseVersion===1;
}
