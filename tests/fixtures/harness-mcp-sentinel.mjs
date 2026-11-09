import {writeFileSync} from 'node:fs';
if(process.argv[2])writeFileSync(process.argv[2],String(process.pid));
process.on('SIGTERM',()=>{});
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>{input+=part;for(;;){const end=input.indexOf('\n');if(end<0)break;const line=input.slice(0,end);input=input.slice(end+1);if(!line.trim())continue;const message=JSON.parse(line);if(message.id===undefined)continue;let result;if(message.method==='initialize')result={protocolVersion:'2025-03-26',serverInfo:{name:'kteam-owned-fixture',version:'1'},capabilities:{tools:{listChanged:true}}};else if(message.method==='tools/list')result={tools:[{name:'proof',description:'Return a fixture marker',inputSchema:{type:'object',properties:{}}}]};else if(message.method==='tools/call')result={content:[{type:'text',text:'MCP_REAL_PROCESS_92'}]};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');}});
setInterval(()=>{},1000);
