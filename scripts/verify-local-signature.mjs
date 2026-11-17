import{execFileSync}from'node:child_process';import{resolve}from'node:path';
const app=resolve('release/mac-arm64/KTeam.app');execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
// codesign emits display information on stderr; verification above is authoritative.
execFileSync(process.execPath,['scripts/verify-packaged-build.mjs',resolve(app,'Contents/Resources')],{stdio:['ignore','pipe','inherit']});
console.log(JSON.stringify({localSignature:'codesign-verified',notarization:'not-checked'}));
