import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';
import {hostRequest} from '../src/service/client.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';

const manifest={
  manifestVersion:1,
  id:'review-kit',
  name:'审阅工具',
  version:'1.0.0',
  contributes:{commands:[{id:'review',title:'开始审阅',draft:'请核对材料中的结论与证据。'}]},
};

test('desktop plugins preview, install and change lifecycle by revision across host restart',async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-plugins-')));
  const upstream={brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'};
  initConfig(root,{version:1,...upstream});
  let host:Awaited<ReturnType<typeof startHost>>|undefined;
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  try {
    host=await startHost({root,upstream});
    await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/plugins/commands'),/app_settings_forbidden/);
    await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/plugins/install',{manifest}),/app_settings_forbidden/);
    await assert.rejects(api.previewPlugin({manifest:{...manifest,manifestVersion:2}}),/plugin_manifest_version/);
    await assert.rejects(api.previewPlugin({manifest:{...manifest,main:'worker.js'}}),/unknown_field/);
    await assert.rejects(api.previewPlugin({manifest:{...manifest,contributes:{commands:[{
      id:'shortcut',title:'Shortcut',draft:'\n /space create test',
    }]}}}),/invalid_plugin_draft/);
    const review=await api.previewPlugin({manifest});
    assert.deepEqual((await api.plugins()).plugins,[]);
    await assert.rejects(api.installPlugin({manifest:{...manifest,name:'Changed'},expectedRevision:review.revision,
      expectedDigest:review.digest}),/plugin_preview_changed/);
    const input={manifest:review.manifest,expectedRevision:review.revision,expectedDigest:review.digest};
    const installed=await api.installPlugin(input);
    assert.equal(installed.plugins[0].enabled,false);
    assert.deepEqual((await api.pluginCommands()).commands,[]);
    await assert.rejects(api.changePlugin({id:manifest.id,action:'enable',expectedRevision:review.revision}),/plugin_changed/);
    const enabled=await api.changePlugin({id:manifest.id,action:'enable',expectedRevision:installed.revision});
    assert.deepEqual(await api.installPlugin(input),enabled);
    await host.close();
    host=await startHost({root,upstream});
    assert.deepEqual(await api.plugins(),enabled);
    const listed:any=await dispatchDesktop(api,'pluginCommands',[]);
    const [choice]=listed.commands;
    const selection={pluginId:choice.pluginId,commandId:choice.commandId,revision:choice.revision};
    assert.equal(choice.draft,undefined);
    assert.equal((await api.pluginDraft(selection)).draft,manifest.contributes.commands[0]!.draft);

    const disabled=await api.changePlugin({id:manifest.id,action:'disable',expectedRevision:enabled.revision});
    assert.deepEqual((await api.pluginCommands()).commands,[]);
    await assert.rejects(api.pluginDraft(selection),/plugin_changed/);
    const reenabled=await api.changePlugin({id:manifest.id,action:'enable',expectedRevision:disabled.revision});
    assert.equal(reenabled.plugins[0].enabled,true);
    await assert.rejects(api.pluginDraft(selection),/plugin_changed/);

    const sameVersion=await api.previewPlugin({manifest:{...manifest,name:'Different'}});
    await assert.rejects(api.installPlugin({manifest:sameVersion.manifest,expectedRevision:sameVersion.revision,
      expectedDigest:sameVersion.digest}),/plugin_version_not_newer/);
    const update=await api.previewPlugin({manifest:{...manifest,version:'1.1.0'}});
    const updated=await api.installPlugin({manifest:update.manifest,expectedRevision:update.revision,expectedDigest:update.digest});
    assert.equal(updated.plugins[0].enabled,false);
    await assert.rejects(api.pluginDraft(selection),/plugin_changed/);
    const removed=await api.changePlugin({id:manifest.id,action:'remove',expectedRevision:updated.revision});
    assert.deepEqual(removed.plugins,[]);
  }finally{
    await host?.close();
    rmSync(root,{recursive:true,force:true});
  }
});
