import {randomBytes} from 'node:crypto';
export {DESKTOP_METHODS} from './semantic-methods.js';
type Call=(route:string,value?:unknown)=>Promise<any>;
const text=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>32768)throw Error('invalid_input');return value;};
const room=(value:unknown)=>encodeURIComponent(text(value));
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
export function createDesktopAPI(call:Call,options:{agentLauncher?:string[];nativeActions?:Record<string,(input?:any)=>Promise<any>>}={}){
 const invitation=async(result:any)=>{const command=[...(options.agentLauncher??['kteam']),'agent','connect','--root',result.dataRoot,'--invite',result.connection.id].map(quote).join(' ');return {...result,command,instruction:'请将当前Agent会话接入KTeam，保留当前模型、工作区和权限。先执行下面的命令：\n\n'+command+'\n\n将返回的确认码告诉我；我会在KTeam确认接入。然后阅读命令返回的Skill，用listen/reply在当前会话持续收发KTeam消息。不要新建替身模型或更改原有工具批准策略。'};};
 return {
 toolPermissions:()=>call('/v1/app/tool-permissions'),revokeToolPermission:(input:unknown)=>call('/v1/app/tool-permissions/revoke',input),
 integrationSettings:()=>call('/v1/app/integrations'),saveIntegrationSettings:(input:unknown)=>call('/v1/app/integrations',input),testIntegration:(input:unknown)=>call('/v1/app/integrations/test',input),importProviderModels:(input:unknown)=>call('/v1/model-settings/import-provider',input),transcribeAudio:(input:unknown)=>call('/v1/app/voice/transcribe',input),
 appPreferences:()=>call('/v1/app/preferences'),saveAppPreferences:(input:unknown)=>call('/v1/app/preferences',input),appResources:()=>call('/v1/app/resources'),
 decisionModels:()=>call('/v1/decision-models'),assistantState:()=>call('/v1/assistant/state'),setAssistantProactivity:(input:unknown)=>call('/v1/assistant/proactivity',input),
 botQuestions:()=>call('/v1/bot-questions'),answerBotQuestion:(input:unknown)=>call('/v1/bot-questions/answer',input),
 toolApprovals:()=>call('/v1/tool-approvals'),decideToolApproval:(input:unknown)=>call('/v1/tool-approvals/decide',input),
 conversationData:(id:unknown)=>call(`/v1/teams/${room(id)}/shared`),
 saveShared:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/shared`,value);},
 messageState:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/message-state`,value);},
 conversationMessage:(input:any)=>call(`/v1/teams/${room(input.roomId)}/message?messageId=${room(input.messageId)}`),
 searchConversation:(input:any)=>call(`/v1/teams/${room(input.roomId)}/search?query=${encodeURIComponent(typeof input.query==='string'?input.query:'')}${input.before!==undefined?'&before='+encodeURIComponent(input.before):''}`),
 importLibrary:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/library-import`,value);},
 previewLibrary:(input:any)=>call(`/v1/teams/${room(input.roomId)}/library-file?fileId=${room(input.fileId)}`),
 removeLibrary:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/library-remove`,value);},
 computer:(id:unknown)=>call(`/v1/teams/${room(id)}/computer`),usage:(id:unknown)=>call(`/v1/teams/${room(id)}/usage`),
 regenerate:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/regenerate`,value);},
 newConversation:(input:unknown)=>call('/v1/conversations/new',input),
 ...Object.fromEntries(['voiceOptions','previewVoice','openLibrary','readAloud','stopSpeech','speechStatus','exportConversation','chooseWorkspace','openSettingsLocation'].map(name=>[name,(input?:unknown)=>{if(!options.nativeActions?.[name])throw Object.assign(Error('desktop_action_unavailable'),{code:'desktop_action_unavailable'});return options.nativeActions[name]!(input);}])) as any,
 builtinAgent:(id?:unknown)=>call('/v1/builtin-agent'+(id?'?modelId='+room(id):'')),probeBuiltinAgent:(input:unknown)=>call('/v1/builtin-agent/probe',input),
 localAgents:()=>call('/v1/local-agents'),probeLocalAgent:(input:unknown)=>call('/v1/local-agents/probe',input),localAgentProbe:(id:unknown)=>call(`/v1/local-agents/${room(id)}/probe`),bindLocalAgent:(input:unknown)=>call('/v1/local-agents/bind',input),createLocalBot:(input:unknown)=>call('/v1/local-agents/create',input),saveBot:(input:unknown)=>call('/v1/bot-profile',input),onboarding:()=>call('/v1/onboarding'),saveOnboarding:(input:unknown)=>call('/v1/onboarding',input),createFirstBot:(input:unknown)=>call('/v1/onboarding/create',input),finishOnboarding:(input:unknown)=>call('/v1/onboarding/finish',input),
 agentConnections:()=>call('/v1/agent-links'),inviteAgent:async(input:unknown)=>invitation(await call('/v1/agent-links',input)),agentInvitation:async(id:unknown)=>invitation(await call(`/v1/agent-links/${room(id)}/status`)),approveAgent:(input:any)=>call(`/v1/agent-links/${room(input.id)}/approve`,{expectedHash:input.expectedHash}),revokeAgent:(id:unknown)=>call(`/v1/agent-links/${room(id)}/revoke`,{}),useSystemAgent:(input:unknown)=>call('/v1/bot-source',input),editGroup:(input:any)=>{const{roomId,...value}=input;return call(`/v1/teams/${room(roomId)}/edit`,value);},
 resumeCreation:(input:any)=>call('/v1/creations/resume',{id:text(input.id)}),inbox:()=>call('/v1/inbox'),bootstrap:()=>call('/v1/bootstrap',{}),direct:(input:any)=>call('/v1/direct',{botId:text(input.botId)}),proposals:(id:unknown)=>call(`/v1/teams/${room(id)}/proposals`),acceptProposal:(input:unknown)=>call('/v1/proposals/accept',input),
 reconnectServices:()=>call('/v1/services/ensure',{}),
 modelSettings:()=>call('/v1/model-settings'),saveModel:(input:unknown)=>call('/v1/model-settings/model',input),setCredentialStorage:(input:unknown)=>call('/v1/model-settings/storage',input),saveDecisionModels:(input:unknown)=>call('/v1/model-settings/decision',input),
 pinConversation:(input:any)=>call(`/v1/teams/${room(input.roomId)}/sidebar`,{pinned:input.pinned}),
 peerExchanges:(input:any)=>call(`/v1/teams/${room(input.roomId)}/peer-exchanges`,{originIds:input.originIds}),peerExchangeMessages:(input:any)=>call(`/v1/teams/${room(input.roomId)}/peer-exchanges/${room(input.exchangeId)}`),status:()=>call('/v1/status'),bots:()=>call('/v1/bots'),teams:()=>call('/v1/teams'),models:()=>call('/v1/models'),runtimes:()=>call('/v1/runtimes'),
 createBot:(input:unknown)=>call('/v1/bot-create',input),createTeam:(input:unknown)=>call('/v1/teams',input),
 send:(input:any)=>call('/v1/messages',{aimp:'1.0',id:input.id??'msg_'+randomBytes(16).toString('hex'),room_id:text(input.roomId),thread_id:'thread-'+text(input.roomId),from:'human://kteam.local/user.local',to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',classification:'internal',...(input.replyToMessageId?{reply_to:text(input.replyToMessageId)}:{}),body:text(input.text)}),
 messages:(input:any)=>{const after=input.after??0,limit=input.limit??100,before=input.before;if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100||(before!==undefined&&(!Number.isSafeInteger(before)||before<1)))throw Error('invalid_pagination');return call(`/v1/teams/${room(input.roomId)}/messages?after=${after}&limit=${limit}${before!==undefined?'&before='+before:''}${input.tail===true?'&tail=true':''}`);},
 settings:(id:unknown)=>call(`/v1/teams/${room(id)}/settings`),work:(id:unknown)=>call(`/v1/teams/${room(id)}/work`),
 reconcile:(id:unknown)=>call(`/v1/teams/${room(id)}/reconcile`,{}),
 pause:(id:unknown)=>call(`/v1/teams/${room(id)}/pause`,{}),resume:(id:unknown)=>call(`/v1/teams/${room(id)}/resume`,{}),
 seen:(input:any)=>call(`/v1/teams/${room(input.roomId)}/seen`,{sequences:input.sequences}),review:(input:any)=>call(`/v1/teams/${room(input.roomId)}/review`,{taskRef:input.taskRef,decision:input.decision}),
};}
export async function dispatchDesktop(api:ReturnType<typeof createDesktopAPI>,method:unknown,args:unknown){
 if(typeof method!=='string'||!Object.hasOwn(api,method)||!Array.isArray(args)||args.length>1)throw Error('desktop_method_forbidden');
 return Reflect.apply((api as any)[method],undefined,args);
}
export function trustedFrame(senderFrame:unknown,mainFrame:unknown){return !!senderFrame&&senderFrame===mainFrame;}
