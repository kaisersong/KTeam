import {fields,record,text} from '../errors.js';

export const artifactDownloadRoute='/v1/artifacts/download';
export const maxArtifactDownloadBytes=64*1024*1024;

export type ArtifactDownloadIdentity=
 | {roomId:string;toolCallId:string}
 | {roomId:string;messageId:string;fileId:string};

export function artifactDownloadIdentity(value:unknown):ArtifactDownloadIdentity{
 const input=record(value);
 const roomId=text(input.roomId,'room_id',256);
 if(Object.hasOwn(input,'toolCallId')){
  fields(input,['roomId','toolCallId']);
  return {roomId,toolCallId:text(input.toolCallId,'tool_call_id',256)};
 }
 fields(input,['roomId','messageId','fileId']);
 return {roomId,messageId:text(input.messageId,'message_id',256),fileId:text(input.fileId,'file_id',64)};
}
