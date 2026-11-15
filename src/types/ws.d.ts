// Minimal surface used by the native ASR client; ws is bundled into the desktop host.
declare module 'ws' {
 import {EventEmitter} from 'node:events';
 export default class WebSocket extends EventEmitter {
  constructor(address:string,options:{headers:Record<string,string>;handshakeTimeout:number;maxPayload:number;followRedirects:boolean});
  send(data:Uint8Array):void;
  terminate():void;
 }
}
