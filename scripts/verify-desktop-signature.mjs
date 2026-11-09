import{execFileSync}from'node:child_process';import{resolve}from'node:path';
const app=resolve('release/mac-arm64/KTeam.app');execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
// codesign emits display information on stderr; verification above is authoritative.
console.log(JSON.stringify({ok:true,app,signature:'verified local ad-hoc bundle'}));
