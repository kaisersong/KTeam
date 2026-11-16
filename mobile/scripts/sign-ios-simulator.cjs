// Simulator Keychain access requires an app identity, including for ad-hoc previews.
const {execFileSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const app=process.argv[2];
if(!app)throw Error('Usage: node mobile/scripts/sign-ios-simulator.cjs /absolute/path/KTeam.app');
const path=resolve(app),plist=join(path,'Info.plist');
const value=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,plist],{encoding:'utf8'}).trim();
if(value('DTPlatformName')!=='iphonesimulator'||value('CFBundleIdentifier')!=='com.kteam.mobile')throw Error('Only the KTeam simulator app can use preview signing. Device builds require provisioning.');
const folder=mkdtempSync(join(tmpdir(),'kteam-simulator-sign-'));
try {
 const entitlements=join(folder,'preview.plist');
 writeFileSync(entitlements,'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>application-identifier</key><string>com.kteam.mobile</string><key>keychain-access-groups</key><array><string>com.kteam.mobile</string></array></dict></plist>',{mode:0o600});
 execFileSync('codesign',['--force','--sign','-','--entitlements',entitlements,path],{stdio:'inherit'});
 execFileSync('codesign',['--verify','--deep','--strict',path],{stdio:'inherit'});
 console.log('Simulator preview signed with its Keychain identity.');
} finally {rmSync(folder,{recursive:true,force:true});}
