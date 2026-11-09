import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {createDesktopAPI,dispatchDesktop} from './semantic-api.ts';
import {hostRequest} from '../src/service/client.ts';
export default defineConfig({root:fileURLToPath(new URL('./renderer',import.meta.url)),base:'./',build:{outDir:'../../build/renderer',emptyOutDir:true},server:{host:'127.0.0.1',port:5192,strictPort:true},plugins:[{
 name:'kteam-development-semantic-api',configureServer(server){
  if(!process.env.KTEAM_DEV_DATA_DIR)return;
  const api=createDesktopAPI((route,value)=>hostRequest(process.env.KTEAM_DEV_DATA_DIR!,'kteam-main',route,value));
  server.middlewares.use('/__kteam_rpc',async(req,res)=>{
   if(req.method!=='POST'||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)){res.writeHead(403);res.end();return;}
   let bytes=0,body='';for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024){res.writeHead(413);res.end();return;}body+=chunk;}
   try{const {method,args}=JSON.parse(body);const value=await dispatchDesktop(api,method,args);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));}
   catch(error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,code:(error as any).code??'desktop_request_failed'}));}
  });
 }}]});
