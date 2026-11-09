import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {botFamily,botAvatarSource} from '../src/bot-appearance.js';

test('master identity and named roles use the supplied hairstyle families',()=>{
 assert.equal(botFamily({name:'小白',isAssistant:true}),'k');
 for(const [name,family] of [['CTO','dev'],['设计师','design'],['产品经理','pm'],['财务','data'],['数据质量','qa']])assert.equal(botFamily({name:name!}),family);
 assert.equal(botFamily({name:'小白',description:'负责开发和代码评审'}),'dev');
 assert.equal(botFamily({name:'设计师',description:'配合产品经理'}),'design');
});
test('custom Bot identity survives sorting, duplicate display names, and fallback rename',()=>{
 const bots=[{name:'阿白',id:'bot-1'},{name:'阿白',id:'bot-2'},{name:'云朵',id:'bot-3'}];
 const before=new Map(bots.map(bot=>[bot.id,botFamily(bot)]));
 for(const bot of bots.reverse())assert.equal(botFamily(bot),before.get(bot.id));
 assert.equal(botFamily({id:'bot-1',name:'新名字'}),before.get('bot-1'));
 assert.equal(botAvatarSource('k',{expressive:true,animated:false}),'./brand/lively/curious-avatar.svg');
 assert.equal(botAvatarSource('dev',{animated:true}),'./brand/bot-v3/dev-right34.svg');
});
test('all imported design assets retain original verified archive bytes',()=>{
 const provenance=JSON.parse(readFileSync('desktop/assets/brand/provenance.json','utf8'));
 assert.equal(provenance.upstreamFilesVerified,250);
 for(const [path,asset] of Object.entries(provenance.files) as [string,{sha256:string}][]){
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),asset.sha256,path);
 }
});
