import { KTeamError, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { supportsRoomWorkspaceProtocol } from '../core-protocol/room-workspace-protocol.js';

export interface UpstreamOptions {
  brokerUrl: string; kswarmUrl: string; brokerToken?: string; kswarmToken?: string;
}

export function loopbackUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new KTeamError('upstream_must_be_loopback');
  }
  return url.origin;
}

/** Semantic adapters over the existing owners; never opens their DBs or starts their schedulers. */
export class Upstreams {
  private brokerUrl: string;
  private kswarmUrl: string;
  constructor(private options: UpstreamOptions) {
    this.brokerUrl = loopbackUrl(options.brokerUrl);
    this.kswarmUrl = loopbackUrl(options.kswarmUrl);
  }
  private async request(component: 'broker' | 'kswarm', route: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const token = component === 'broker' ? this.options.brokerToken : this.options.kswarmToken;
    if ((component === 'broker' || method !== 'GET') && !token) throw new KTeamError(component + '_credential_required', 503);
    let response: Response;
    try {
      const signal=AbortSignal.timeout(10_000);
      const fetchOnce=()=>fetch((component === 'broker' ? this.brokerUrl : this.kswarmUrl) + route, {
        method, redirect: 'error', signal,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { [component === 'broker' ? 'x-intent-broker-room-token' : 'x-kswarm-mutation-token']: token } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      try{response=await fetchOnce();}catch(error){
        const code=(error as {cause?:{code?:string}})?.cause?.code;
        // Read-only requests may meet a stale keep-alive socket after sleep/restart.
        // A mutation receipt stays unknown: never retry POST/PUT or redirects.
        if(method!=='GET'||!['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET'].includes(code??'')||signal.aborted)throw error;
        response=await fetchOnce();
      }
    } catch {
      // A timeout after POST is an unknown result: caller must reuse the same request ID.
      throw new KTeamError(method === 'GET' ? component + '_unavailable' : 'upstream_operation_unknown', 503);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (!reader) throw new KTeamError(method === 'GET' ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new KTeamError('upstream_response_too_large', 502); }
        chunks.push(chunk.value);
      }
      let result: Record<string, unknown>;
      try { result = record(parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), 2 * 1024 * 1024)); }
      catch { throw new KTeamError(method === 'GET' ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502); }
      if (!response.ok || result.ok === false) {
        // Broker duplicate is an original receipt, not permission to run anything again.
        if (result.code === 'room_message_duplicate' && result.message) return { ...result, ok: true, reused: true };
        const code = String((typeof result.code==='string'?result.code:result.error) ?? 'upstream_rejected');
        throw new KTeamError(/^[a-z0-9_-]+$/.test(code) ? code : 'upstream_rejected', response.status >= 400 ? response.status : 409);
      }
      return result;
    } catch (error) {
      if (error instanceof KTeamError) throw error;
      throw new KTeamError(method === 'GET' ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502);
    } finally { reader.releaseLock(); }
  }
  async probe() {
    const [broker, kswarm] = await Promise.allSettled([
      this.request('broker', '/rooms/workspace-protocol'), this.request('kswarm', '/health'),
    ]);
    const summarize = (result: PromiseSettledResult<Record<string, unknown>>) => result.status === 'fulfilled'
      ? { available: true, workspaceProtocol: supportsRoomWorkspaceProtocol(result.value),botPrivateMessages:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('bot-private-messages'),externalAgentMessages:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('external-agent-messages'),conversationContext:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('conversation-context'),messageRevisionCAS:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('message-revision-cas') }
      : { available: false, workspaceProtocol: false, externalAgentMessages:false,botPrivateMessages:false,messageRevisionCAS:false,reason: result.reason instanceof KTeamError ? result.reason.code : 'upstream_unavailable' };
    const b = summarize(broker), k = summarize(kswarm);
    return { broker: b, kswarm: k, ready: b.workspaceProtocol && b.botPrivateMessages && b.messageRevisionCAS && b.conversationContext && k.workspaceProtocol };
  }
  async requireReady(): Promise<void> {
    const status = await this.probe();
    if (!status.ready) throw new KTeamError(status.broker.workspaceProtocol&&(!status.broker.conversationContext||!status.broker.botPrivateMessages)?'conversation_service_upgrade_required':'upstream_protocol_unavailable', 503, status);
  }
  conversationData(roomId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/conversation`);}
  conversationMessage(roomId:string,messageId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/message?messageId=${encodeURIComponent(messageId)}`);}
  searchConversation(roomId:string,query:string,before?:number){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/search?query=${encodeURIComponent(query)}${before?'&before='+before:''}`);}
  updateConversation(roomId:string,input:Record<string,unknown>,agent=false){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/${agent?'agent-conversation':'conversation'}`,'POST',input);}
  listBots() { return this.request('kswarm', '/agents'); }
  updateBot(botId:string,input:Record<string,unknown>){return this.request('kswarm',`/agents/${encodeURIComponent(botId)}`,'PUT',input);}
  createBot(input:Record<string,unknown>){return this.request('kswarm','/agents','POST',input);}
  aimp(roomId:string,command:string,input?:Record<string,unknown>){
    if(!['session','status','tasks','configure','event','agent-event','begin-execution','execution-check','effect','heartbeat','chat','verify-delivery'].includes(command))throw new KTeamError('aimp_command_invalid');
    return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/aimp/${command}`,input?'POST':'GET',input);
  }
  async requireExternalMessages(){const result=await this.probe();if(!result.ready||!result.broker.externalAgentMessages)throw new KTeamError('agent_service_upgrade_required',503);}
  deleteTeam(roomId:string,expectedRoomRevision:number){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/delete`,'POST',{expectedRoomRevision});}
  updateTeam(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/metadata`,'PUT',input);}
  externalReply(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/agent-messages`,'POST',input);}
  registerNativeParticipant(input:Record<string,unknown>){return this.request('broker','/participants/register','POST',input);}
  listRuntimes() { return this.request('kswarm', '/runtimes'); }
  listProjects() { return this.request('kswarm', '/projects'); }
  listTeams() { return this.request('broker', '/rooms'); }
  getTeam(roomId: string) { return this.request('broker', '/rooms/' + encodeURIComponent(roomId)); }
  membership(roomId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/membership`);}
  createTeam(input: Record<string, unknown>) { return this.request('broker', '/rooms', 'POST', input); }
  messages(roomId: string, after: number, limit: number,before?:number,tail=false) {
    return this.request('broker', `/rooms/${encodeURIComponent(roomId)}/messages?afterSequence=${after}&limit=${limit}${before!==undefined?'&beforeSequence='+before:''}${tail?'&direction=backward':''}`);
  }
  sendBotPrivate(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/bot-messages`,'POST',input);}
  sendMessage(roomId: string, input: Record<string, unknown>) {
    return this.request('broker', `/rooms/${encodeURIComponent(roomId)}/messages`, 'POST', input);
  }
}
