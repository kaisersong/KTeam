import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateTempDir} from './helpers/private-temp.js';
import {removeTempRoot} from './helpers/tmp-root.js';
import {TeamStore} from '../src/service/team-store.js';
test('opening the original store waits for another process to finish a brief write without resetting persisted state',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-store-lock-')),initial=new TeamStore(root);initial.setState('lock-proof','preserved');initial.close();
 const child=spawn(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.disconnect();},600);`,join(root,'team-extensions.sqlite')],{stdio:['ignore','ignore','pipe','ipc']});
 const exited=once(child,'exit');let store:TeamStore|undefined;
 try{assert.deepEqual(await once(child,'message'),['locked',undefined]);const started=Date.now();store=new TeamStore(root);assert.equal(store.state('lock-proof'),'preserved');assert.ok(Date.now()-started>=150);store.setState('after-lock',true);store.close();store=undefined;const [code]=await exited;assert.equal(code,0);}
 finally{store?.close();if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;removeTempRoot(root);}
});
