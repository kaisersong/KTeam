// Checked product seams; original xiaok files remain hash-identical.
export function adaptKTeamConfig(path,source){
 let text=source;const replace=(a,b)=>{if(!text.includes(a))throw Error('kteam_config_basis_changed:'+path);text=text.replace(a,b);};
 const root="(process.env.KTEAM_MODEL_CONFIG_DIR ?? join(process.env.KTEAM_DATA_DIR ?? join(homedir(), '.kteam'), 'runtime'))";
 text=text.replace(/process\.env\.XIAOK_CONFIG_DIR\s*\?\?\s*join\(homedir\(\),\s*['"]\.xiaok['"]\)/g,root);
 text=text.replace(/join\(homedir\(\),\s*['"]\.xiaok['"](?=\s*[,)])/g,`join(${root}`);
 text=text.replaceAll("resolve(home, '.xiaok', 'plugins')", "resolve(process.env.KTEAM_MODEL_CONFIG_DIR??resolve(process.env.KTEAM_DATA_DIR??resolve(home,'.kteam'),'runtime'),'plugins')");
 if(path.endsWith('/runtime/verification/profile-account-home.ts'))replace('const config=process.env.XIAOK_CONFIG_DIR;',"const config=process.env.KTEAM_MODEL_CONFIG_DIR??join(process.env.KTEAM_DATA_DIR??join(userInfo().homedir,'.kteam'),'runtime');");
 if(path.endsWith('/runtime/verification/known-directory-writer-fence.ts'))replace("base=join(home,'.xiaok')","base=resolve(process.env.KTEAM_MODEL_CONFIG_DIR??resolve(process.env.KTEAM_DATA_DIR??resolve(home,'.kteam'),'runtime'))");
 if(path.endsWith('/shared/credential-fields.ts'))replace("secretKey.test(path.at(-1)??'')","(path.at(-2)==='env'||path.at(-2)==='headers'||secretKey.test(path.at(-1)??''))");
 if(path.endsWith('/utils/config.ts'))replace('return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;',"return {...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),providers:{},models:{},defaultProvider:'',defaultModelId:''} as Config;");
 if(path.endsWith('/utils/system-credentials.ts')){
  replace("'com.xiaok.credentials.v1'","'com.kteam.credentials.v1'");
 }
 if(path.endsWith('/utils/protected-json.ts')){
  replace('  updateAutomation(enabled:boolean', `  saveKTeamPublic(input:unknown,expectedHash:string):void {if(!object(input)||Object.hasOwn(input,META))throw Error('credential_reserved_input');this.lock(()=>{if(protectedJsonDigest(this.file)!==expectedHash)throw Error('credential_config_changed');const raw=this.raw()??{},next=structuredClone(input),slots=entries(next),replaced=new Set(slots.map(s=>JSON.stringify(s.path)));for(const old of entries(raw))if(!replaced.has(JSON.stringify(old.path))&&object(getAt(next,old.path.slice(0,-1))))setAt(next,old.path,old.value);const sealed=this.seal(next),fresh=this.refs(sealed),keep=this.refs(raw).filter(r=>!replaced.has(JSON.stringify(r.path))&&!fresh.some(f=>JSON.stringify(f.path)===JSON.stringify(r.path))&&object(getAt(next,r.path.slice(0,-1))));const refs=[...fresh,...keep];if(refs.length>256)throw Error('credential_limit');if(refs.length)sealed[META]={version:1,entries:refs};if(protectedJsonDigest(this.file)!==expectedHash)throw Error('credential_config_changed');this.atomic(this.file,sealed);});}
  updateAutomation(enabled:boolean`);
 }
 if(path.endsWith('/utils/credential-store.ts')){
  replace("if(raw.backend==='keychain'&&Object.keys(raw.entries).length)","if(raw.backend==='keychain'&&Object.values(raw.entries).some(value=>value!==''))");
  const a=text.indexOf('    return this.locked((current,root,guard)=>{',text.indexOf('  get(id:string)')),b=text.indexOf('\n  put(id:string',a);
  if(a<0||b<0)throw Error('kteam_file_fallback_basis_changed');text=text.slice(0,a)+'    return null;\n  }'+text.slice(b);
  replace("if(state.backend==='keychain'){this.nativePut(id,value);guard();return;}","if(state.backend==='keychain'){this.nativePut(id,value);state.entries[id]='';this.write(root,state,guard);return;}");
  replace("      this.write(root,{version:1,backend:kind,entries:{}},guard);", "      const entries:Record<string,string>={};if(kind==='keychain'){for(const id of Object.keys(state.entries))entries[id]='';}else{for(const id of Object.keys(state.entries)){const value=this.nativeGet(id);if(value===null)fail('missing');entries[id]=value;}}\n      this.write(root,{version:1,backend:kind,entries},guard);");
 }
 return text;
}
