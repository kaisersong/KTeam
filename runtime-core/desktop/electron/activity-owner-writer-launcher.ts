import type {DesktopPreparationCompositionLaunch} from './default-dispatch-preparation-composition-bootstrap.js';
import {createOwnedCanonicalBusiness,prepareOwnedCanonicalBusinessHello,assertOwnedCanonicalBusinessHelloCurrent,readOwnedCanonicalBusinessRetirement,observeOwnedCanonicalBusinessClose,readOwnedCanonicalPreparationFacet,readOwnedCanonicalPreparationWorkBinding,type CanonicalPreparationFacet,type CanonicalPreparationSource,type CanonicalPreparationAdmission,type CanonicalBusinessAdmission} from '../../src/runtime/conversation-activity/owned-canonical-business.js';
import {dispatchBusinessProtocolTag} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import type {DesktopDispatchLaunch} from './default-dispatch-native-bootstrap.js';
import {spawn,type ChildProcess} from '../../../src/runtime/harness-child-process.js';
import {createConnection} from 'node:net';
import {openSync,closeSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {randomBytes} from 'node:crypto';
import {readKSwarmOwnedControlServiceScope,readKSwarmOwnedBusinessServiceScope,type KSwarmOwnedBusinessTransport,type KSwarmService} from './kswarm-service.js';
import {readKSwarmWriterControlBootstrap,type KSwarmWriterControlSource} from './kswarm-writer-control-source.js';
import type {DesktopWriterControlLaunch} from './kswarm-writer-control-native-bootstrap.js';
import type {KSwarmOwnedControlContext,KSwarmOwnedControlOperation} from './kswarm-owned-control.js';
import type {ActivityOwnerConfig} from '../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerConfigDigest} from '../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerAddress,readActivityOwnerCredentials,ACTIVITY_OWNER_GENERATION} from '../../src/runtime/conversation-activity/owner-protocol.js';
import {ACTIVITY_STORAGE_NAMES,chmodPrivateActivityFile} from '../../src/runtime/conversation-activity/storage-permissions.js';
import {buildActivityOwnerEnv} from '../../src/runtime/conversation-activity/owner-launcher.js';
import {ConversationActivityOwnerClient} from '../../src/runtime/conversation-activity/owner-client.js';
import {captureOwnedConfigurationData} from '../../src/runtime/conversation-activity/owned-kswarm-control.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
const NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
const descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,own=Object.hasOwn,define=Object.defineProperty,freeze=Object.freeze,create=Object.create,setPrototype=Object.setPrototypeOf,assign=Object.assign,splice=Array.prototype.splice,ownDescriptor=Object.getOwnPropertyDescriptor;
const preparationIsProxy=types.isProxy,preparationIsAsync=types.isAsyncFunction;
const protocol='activity_desktop_config_v1',prototypeOf=Object.getPrototypeOf,asyncPrototype=Object.getPrototypeOf(async()=>{});
type Scope=Readonly<{profileId:string;workspaceId:string}>;
type Operation='inspect_writer'|'prepare_initial_plan_writer';
interface Status {profileId:string;generation?:number;configDigest?:string;ready?:boolean;pid?:number;ownerEpoch?:string;nativeSourceProtocol?:number}
interface LaunchSdkTail {raw:Promise<unknown>;completed:boolean;listeners:Array<()=>void>}
interface PreparationLaunchState {owner:object;capsule:object;composition?:Readonly<DesktopPreparationCompositionLaunch>;port?:CanonicalPreparationFacet;failure?:{error:unknown}}
interface LaunchState {dispatchClient?:ReturnType<typeof createOwnedCanonicalBusiness>;preparation?:PreparationLaunchState;source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;scope:Scope;digest?:string;promise:Promise<ConversationActivityOwnerClient>;workRaw?:Promise<void>;observationUnknown?:boolean;spawnFailure?:unknown;retainedInitialization:ReturnType<typeof createIntrinsicSet<unknown>>;workDone:Promise<void>;workCompleted:boolean;initializationListeners:Array<()=>void>;complete():void;closed:boolean;failure?:unknown;relay?:Relay;child?:ChildProcess;configArtifact?:string;closing?:Promise<void>;sdkFailure?:unknown;sdkErrors:unknown[];sdkTails:ReturnType<typeof createIntrinsicSet<LaunchSdkTail>>;retirementSdkTail?:((tail:LaunchSdkTail)=>void);business?:{controller:object;capsule:object;launch?:DesktopDispatchLaunch;port?:KSwarmOwnedBusinessTransport;admission?:CanonicalBusinessAdmission;initialized:boolean}}
interface Relay {readonly installed:boolean;call(op:Operation,context:KSwarmOwnedControlContext):Promise<unknown>;seal():void;drain():Promise<void>;observeClose(done:(error?:unknown)=>void):void;retirement():Readonly<{revision:number;known:boolean}>}
interface BusinessBootstrap {controller:object;capsule:object}
interface PreparationBootstrap {owner:object;capsule:object}
interface LaunchOptions {source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;businessBootstrap?:BusinessBootstrap;preparationBootstrap?:PreparationBootstrap}
function hex(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function nonce(){const bytes=randomBytes(32);let result='';const digits='0123456789abcdef';for(let i=0;i<bytes.length;i++)result+=digits[bytes[i]!>>>4]!+digits[bytes[i]!&15]!;return result;}
function same(a:Scope,b:Scope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
function inert(raw:unknown):unknown{if(!raw||typeof raw!=='object')return raw;setPrototype(raw,null);const rows=descriptors(raw),keys=ownKeys(rows);for(let i=0;i<keys.length;i++){const key=keys[i]!;if(typeof key==='string'&&key!=='length'&&own(rows[key]!,'value'))inert(rows[key]!.value);}return raw;}
function data(raw:unknown){return inert(captureOwnedConfigurationData(raw)) as Record<string,unknown>;}
function exact(row:Record<string,unknown>,keys:readonly string[]){const names=ownKeys(row);if(names.length!==keys.length)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');for(let i=0;i<keys.length;i++)if(!own(row,keys[i]!))throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
const closePromiseConstructor=freeze(assign(create(null),{[Symbol.species]:NativePromise}));
function observe(raw:Promise<void>,yes:()=>void,no:(error:unknown)=>void){assertStandardIpcPromise(raw,'WRITER_CONFIG_TAIL_UNKNOWN');void apply(then,raw,[yes,no]);}
interface Wire {frame:Record<string,unknown>;types:readonly string[];sent:boolean;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;knownDone:boolean;knownCompletion:Promise<void>;completeKnown():void;closed:boolean;reply?:Record<string,unknown>;raw?:unknown;failure?:unknown;delivered:boolean;completion:Promise<void>;complete():void;resolve(value:Record<string,unknown>):void;reject(error:unknown):void;timer?:ReturnType<typeof setTimeout>}