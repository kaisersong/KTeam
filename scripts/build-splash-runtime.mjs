import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync('vendor/splash/manifest.json','utf8'));
const file='vendor/splash/splash-runtime.cjs';
if(createHash('sha256').update(readFileSync(file)).digest('hex')!==manifest.sha256)throw Error('splash_runtime_integrity');
mkdirSync('build',{recursive:true});copyFileSync(file,'build/splash-runtime.cjs');
