import{execFileSync}from'node:child_process';import{resolve}from'node:path';
// Local pack:desktop check only. This verifies the ad-hoc signature of the locally built
// bundle; it says nothing about notarization or release readiness — those are gated by
// .github/workflows/release.yml on CI, not by this script.
const app=resolve('release/mac-arm64/KTeam.app');execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
// codesign emits display information on stderr; verification above is authoritative.
console.log(JSON.stringify({localSignature:'codesign-verified',notarization:'not-checked'}));
