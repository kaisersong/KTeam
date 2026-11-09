import {chromium} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
 await page.setContent('<style>body{margin:0;background:transparent}</style>'+readFileSync('desktop/assets/icon.svg','utf8'));
 mkdirSync('build/KTeam.iconset',{recursive:true});await page.screenshot({path:'build/icon-1024.png',omitBackground:true});
}finally{await browser.close();}
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
 execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),'build/icon-1024.png','--out',`build/KTeam.iconset/icon_${size}x${size}${scale===2?'@2x':''}.png`],{stdio:'ignore'});
}
execFileSync('/usr/bin/iconutil',['-c','icns','build/KTeam.iconset','-o','desktop/assets/icon.icns']);
