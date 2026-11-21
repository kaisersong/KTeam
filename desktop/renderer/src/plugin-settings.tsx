import {useEffect,useState} from 'react';
import {api,explain} from './api';
import type {PluginPreview,PluginRegistryView} from '../../../src/protocol/plugins';

export function PluginSettings(){
  const [registry,setRegistry]=useState<PluginRegistryView>();
  const [source,setSource]=useState('');
  const [preview,setPreview]=useState<PluginPreview>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let live=true;
    void api.plugins().then(value=>{if(live)setRegistry(value);})
      .catch(error=>{if(live)setError(explain(error));});
    return()=>{live=false;};
  },[]);

  const act=async(task:()=>Promise<void>)=>{
    setBusy(true);
    setError('');
    try{await task();}
    catch(error){setError(explain(error));}
    finally{setBusy(false);}
  };
  const review=()=>void act(async()=>{
    let manifest:unknown;
    try{manifest=JSON.parse(source);}
    catch{throw Error('请粘贴有效的 JSON 插件清单。');}
    setPreview(await api.previewPlugin({manifest}));
  });
  const install=()=>void act(async()=>{
    if(!preview)return;
    setRegistry(await api.installPlugin({manifest:preview.manifest,expectedRevision:preview.revision,expectedDigest:preview.digest}));
    setPreview(undefined);
    setSource('');
  });
  const change=(id:string,action:'enable'|'disable'|'remove')=>void act(async()=>{
    if(!registry)return;
    setRegistry(await api.changePlugin({id,action,expectedRevision:registry.revision}));
    setPreview(undefined);
  });

  return <>
    <section className="settings-block" aria-label="已安装插件">
      <h2>已安装插件</h2>
      <p className="settings-description">启用后，在会话中输入 /plugin 可查看插件命令。</p>
      <button type="button" className="secondary" disabled={busy}
        onClick={()=>void act(async()=>{setRegistry(await api.plugins());setPreview(undefined);})}>刷新插件</button>
      {registry?.plugins.length===0&&<p>还没有安装插件。</p>}
      <div className="settings-list">
        {registry?.plugins.map(({manifest,enabled})=><article key={manifest.id} className="settings-block">
          <h3>{manifest.name} <small>{manifest.id} · v{manifest.version}</small></h3>
          {manifest.description&&<p>{manifest.description}</p>}
          <p>{enabled?'已启用':'已停用'}</p>
          <div className="workspace-inline">
            <button type="button" className="secondary" disabled={busy}
              aria-label={(enabled?'停用 ':'启用 ')+manifest.name}
              onClick={()=>change(manifest.id,enabled?'disable':'enable')}>{enabled?'停用':'启用'}</button>
            <button type="button" className="secondary" disabled={busy} aria-label={'移除 '+manifest.name}
              onClick={()=>change(manifest.id,'remove')}>移除</button>
          </div>
        </article>)}
      </div>
      {!registry&&!error&&<p role="status">正在读取插件…</p>}
    </section>
    <section className="settings-block" aria-label="导入插件">
      <h2>导入插件</h2>
      <label>JSON 插件清单
        <textarea className="shared-editor" rows={7} value={source} disabled={busy} maxLength={131072}
          onChange={event=>{setSource(event.target.value);setPreview(undefined);}}/>
      </label>
      <button type="button" className="secondary" disabled={busy||!source.trim()} onClick={review}>预览清单</button>
      {preview&&<section aria-label="插件预览">
        <h3>{preview.manifest.name} · v{preview.manifest.version}</h3>
        <p>清单 ID {preview.manifest.id}。安装后可手动启用。</p>
        {preview.manifest.description&&<p>{preview.manifest.description}</p>}
        {preview.manifest.contributes.commands.map(command=><details key={command.id}>
          <summary>{command.title} · /plugin {preview.manifest.id}/{command.id}</summary>
          <pre className="raw-markdown">{command.draft}</pre>
        </details>)}
        <button type="button" className="primary" disabled={busy} onClick={install}>确认安装</button>
      </section>}
      {error&&<p role="alert" className="settings-error">{error}</p>}
    </section>
  </>;
}
