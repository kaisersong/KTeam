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
