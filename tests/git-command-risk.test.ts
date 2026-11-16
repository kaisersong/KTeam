import {test} from 'node:test';import assert from 'node:assert/strict';
import {gitCommandRisk} from '../src/service/git-command-risk.js';
import {terminalRequiresConfirmation} from '../src/service/terminal-permissions.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {analystQuery} from './helpers/analyst-query.js';
test('Git option scope distinguishes grep counts and switch creation from global configuration',async()=>{
 const core=await sharedRuntime();
 for(const command of ["git grep -c 'sourceMessageIds:\\[\\]' origin/main -- src/","git grep -o 'cost:null' HEAD -- src/",'git switch -c local origin/main','git fetch origin','git -C /work/repo grep -c config HEAD','git commit -m "config remote gc"']){assert.equal(gitCommandRisk(command),false,command);assert.equal(terminalRequiresConfirmation(core,command),false,command);}
 assert.equal(terminalRequiresConfirmation(core,analystQuery),false);
 for(const command of ['git -c core.sshCommand=unexpected fetch origin','git -C /work/repo --config-env=core.sshCommand=COMMAND fetch origin','git --exec-path=/outside grep text','git push origin main','git reset --hard','git checkout -f main','git switch -C local','git merge -s custom origin/main','git branch -D local','git tag --delete tag','git worktree remove child','git commit --amend','git grep -Ounexpected text'])assert.equal(terminalRequiresConfirmation(core,command),true,command);
});
