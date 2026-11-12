// Platforms KTeam desktop is verified to build and release on. Anything else is refused,
// so an unverified host never produces a package that looks official.
// darwin-arm64: Developer ID signed + notarized dmg/zip. win32-x64: unsigned NSIS installer + portable exe.
export const VERIFIED_PLATFORMS=Object.freeze({
 'darwin-arm64':Object.freeze({electronBinary:'Electron.app/Contents/MacOS/Electron'}),
 'win32-x64':Object.freeze({electronBinary:'electron.exe'}),
});
export function verifiedPlatform(code,platform=process.platform,arch=process.arch){
 const key=`${platform}-${arch}`;
 const spec=Object.hasOwn(VERIFIED_PLATFORMS,key)?VERIFIED_PLATFORMS[key]:undefined;
 if(!spec)throw Error(code);
 return {key,platform,arch,...spec};
}
