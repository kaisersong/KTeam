import {test} from 'node:test';import assert from 'node:assert/strict';
import {readOnlyShell} from '../src/service/read-only-shell.js';
test('bounded read-only shell checks support variables, safe substitutions, finite loops and conditional reads',()=>{
 for(const command of [
  'cd /work && ls build 2>/dev/null | head; BUNDLE=$(ls build/*.js 2>/dev/null | head -1); echo "BUNDLE=$BUNDLE"; if [ -n "$BUNDLE" ]; then grep -c "attachment-thumb" "$BUNDLE" || echo "none"; fi',
  'J=build/index.js; C=build/index.css; for s in attachment-thumb 放大预览 attachment-lightbox; do printf "%s: %s\\n" "$s" "$(grep -c "$s" $J || true)"; done; cat build/build-info.json',
  'F="a b"; if [ -z "$F" ]; then echo empty; else grep -c text "$F"; fi',
  "echo '$(touch sentinel)'; grep -c 'aria-label:\"电脑\"' file.js",
 ])assert.equal(readOnlyShell(command),true,command);
});
test('unknown, mutating, dynamic command names and environment-changing shell forms stay outside automatic read approval',()=>{
 for(const command of [
  'ls; touch sentinel','F=$(rm sentinel); echo "$F"','F=$(ls); "$F"','ls > sentinel','ls >> /dev/null','ls 2>sentinel',
  'ls <(touch sentinel)','ls `touch sentinel`','ls &','eval "ls"','sh -c ls','node -e "console.log(1)"','curl https://example.com',
  'PATH=/tmp; ls','PS4=bad; ls','BASH_CMDS=bad; ls','IFS=x; ls','LD_PRELOAD=/tmp/lib; ls','for PATH in /tmp; do ls; done','for x in $(ls); do echo "$x"; done',
  'printf -v PATH /tmp; ls','printf "%n" PATH; ls','echo "$HOME"','echo ${HOME}','echo $((1+1))','ls # comment',
  'for x in a b; do rm "$x"; done','while true; do ls; done','F=$(ls; printf -v PATH /tmp); echo "$F"',
  'if [ -n x ]; then ls','ls; fi','F=$(ls','F="unterminated',
 ])assert.equal(readOnlyShell(command),false,command);
 assert.equal(readOnlyShell('echo '+ 'x'.repeat(9000)),false);
});

test('Git object reads and repository version probes stay read-only inside the complete screenshot shell forms',()=>{
 for(const command of [
  `cd /work && for rev in 8fddba4 1e2556b; do echo "== $rev =="; git show $rev:desktop/renderer/src/main.tsx | grep -oE 'ComposerAttachmentList[^>]{0,160}' | head -2; done`,
  `cd /work && sed -n '15,30p' scripts/verify-sources.mjs; for d in /work/kswarm /work/intent-broker /work/.sources/kswarm; do if [ -d "$d" ]; then echo "$d -> $(git -C "$d" rev-parse HEAD 2>/dev/null | cut -c1-7)"; fi; done`,
  'git status --short; git log -3 --oneline; git --no-pager diff --no-ext-diff --no-textconv',
 ])assert(readOnlyShell(command),command);
 for(const command of ['git push origin main','git -c alias.inspect="!touch bad" inspect','git show HEAD --output=bad','git show HEAD --out=bad','git show *','git diff --ext-diff','git cat-file --filters HEAD:file','R=$(cat file); git show $R','for rev in --output=bad; do git show $rev; done','sed -i s/a/b/ file','sed -n "1e touch bad" file','sed -n "1w bad" file'])assert.equal(readOnlyShell(command),false,command);
});
