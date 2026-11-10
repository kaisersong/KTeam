/** Serialize narrow changes and read the current revision for each deliberate selection. No automatic retries. */
export function createSettingsAutosave(api:any){
 let preferenceQueue:Promise<unknown>=Promise.resolve(),integrationQueue:Promise<unknown>=Promise.resolve();
 const enqueue=(kind:'preferences'|'integrations',write:()=>Promise<any>)=>{const operation=(kind==='preferences'?preferenceQueue:integrationQueue).then(write);const settled=operation.then(()=>undefined,()=>undefined);if(kind==='preferences')preferenceQueue=settled;else integrationQueue=settled;return operation;};
 return {
  preferences:(patch:Record<string,unknown>)=>enqueue('preferences',async()=>{const current=await api.appPreferences();return api.saveAppPreferences({...patch,expectedRevision:current.preferences.revision});}),
  integration:(section:string,patch:any)=>enqueue('integrations',async()=>{const current=await api.integrationSettings(),base=current.settings[section];let value:any;if(section==='web'){value={search:{...base.search,...patch.search},fetch:{...base.fetch,...patch.fetch}};for(const kind of ['search','fetch'])for(const key of Object.keys(value[kind]))if(key.startsWith('has'))delete value[kind][key];}else{value={...base,...patch};delete value.hasApiKey;if(section==='voice'&&value.profiles)value.profiles=Object.fromEntries(Object.entries(value.profiles).map(([id,row]:[string,any])=>{const {hasApiKey,...profile}=row;return [id,profile];}));}return api.saveIntegrationSettings({expectedRevision:current.revision,section,value});}),
 };
}
