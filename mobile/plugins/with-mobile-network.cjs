const {withAndroidManifest}=require('@expo/config-plugins');
module.exports=config=>withAndroidManifest(config,c=>{const app=c.modResults.manifest.application?.[0];if(!app)throw Error('Android application missing');app.$['android:usesCleartextTraffic']='true';return c;});
