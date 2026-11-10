import {configureBundledYzjCli} from './bundled-yzj-cli.js';
import {ManagedEnterpriseCliRuntime} from './enterprise-cli-runtime.js';
export function configureConnectorClis(){configureBundledYzjCli();new ManagedEnterpriseCliRuntime().configurePath();}
