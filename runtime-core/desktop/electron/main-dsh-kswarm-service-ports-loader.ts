import { types } from 'node:util';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import type * as OriginalProcessSdk from './main-dsh-kswarm-service-ports.js';
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
const create = Object.create, define = Object.defineProperty, freeze = Object.freeze, own = Object.hasOwn;
const NativePromise = Promise, nativeThen = Promise.prototype.then, isProxy = types.isProxy;
const exportNames = ['readOriginalMainDshServicesBinding','prepareOriginalMainDshSourceKSwarmChild','prepareOriginalMainDshSourceBrokerChild'] as const;
const consumeExports = () => { };