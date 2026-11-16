const{getDefaultConfig}=require('expo/metro-config');
const path=require('path');
const config=getDefaultConfig(__dirname);
config.watchFolders=[path.resolve(__dirname,'..')];
config.resolver.nodeModulesPaths=[path.resolve(__dirname,'node_modules'),path.resolve(__dirname,'../node_modules')];
config.resolver.resolveRequest=(context,name,platform)=>{
 if(name==='punycode')return{filePath:require.resolve('punycode/'),type:'sourceFile'};
 if(name==='sodium-native'||name==='sodium-universal')return{filePath:require.resolve('sodium-javascript'),type:'sourceFile'};
 return context.resolveRequest(context,name,platform);
};
module.exports=config;
