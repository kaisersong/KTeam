import {createPrivateKey,sign} from 'node:crypto';
import {readFileSync,appendFileSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';

const mode=process.argv[2];
if(!['ensure-new','wait'].includes(mode))throw Error('invalid_testflight_status_mode');
const {expo}=JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8'));
const key=createPrivateKey(readFileSync(process.env.APPLE_AUTH_KEY_PATH));
const base64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=()=>{
 const now=Math.floor(Date.now()/1000);
 const unsigned=base64({alg:'ES256',kid:process.env.APPLE_API_KEY_ID,typ:'JWT'})+'.'+
  base64({iss:process.env.APPLE_API_ISSUER,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
 return unsigned+'.'+sign('sha256',Buffer.from(unsigned),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
};
async function get(path,params){
 const url=new URL('/v1/'+path,'https://api.appstoreconnect.apple.com');
 url.search=new URLSearchParams(params).toString();
 const response=await fetch(url,{headers:{authorization:'Bearer '+token()},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('app_store_connect_'+response.status);
 const {data}=await response.json();
 if(!Array.isArray(data))throw Error('app_store_connect_invalid_response');
 return data;
}

const apps=await get('apps',{'filter[bundleId]':expo.ios.bundleIdentifier,'fields[apps]':'bundleId',limit:'2'});
if(apps.length!==1||apps[0].attributes?.bundleId!==expo.ios.bundleIdentifier)throw Error('testflight_app_registration_missing');
const appId=apps[0].id;
const exactBuild=async()=>{
 const rows=await get('builds',{
  'filter[app]':appId,'filter[preReleaseVersion.version]':expo.version,'filter[preReleaseVersion.platform]':'IOS',
  'filter[version]':expo.ios.buildNumber,'fields[builds]':'version,processingState',limit:'2',
 });
 if(rows.length>1)throw Error('testflight_build_identity_ambiguous');
 return rows[0];
};

if(mode==='ensure-new'){
 const build=await exactBuild();
 if(build)throw Error('testflight_build_number_already_present');
 console.log('App Store Connect app and build identity verified.');
}else{
 const deadline=Date.now()+20*60000;
 while(Date.now()<deadline){
  const build=await exactBuild();
  const state=build?.attributes?.processingState;
  if(state==='VALID'){
   const link='https://appstoreconnect.apple.com/apps/'+encodeURIComponent(appId)+'/testflight/ios';
   const details=await get('buildBetaDetails',{'filter[build]':build.id,'fields[buildBetaDetails]':'internalBuildState,externalBuildState',limit:'1'});
   const beta=details[0]?.attributes;
   const summary='TestFlight '+expo.version+' ('+expo.ios.buildNumber+') 已通过 Apple 构建处理。\n'+
    '内部测试 '+(beta?.internalBuildState??'待核对')+' · 外部测试 '+(beta?.externalBuildState??'待核对')+'\n'+link+'\n';
   if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
   console.log(summary);
   process.exit(0);
  }
  if(state==='FAILED'||state==='INVALID')throw Error('testflight_build_'+state.toLowerCase());
  await setTimeout(30000);
 }
 throw Error('testflight_processing_unconfirmed');
}
