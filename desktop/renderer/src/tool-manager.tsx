import {useState} from 'react';
import {WebToolsSettings,CUASettings} from './integration-settings';
import {SettingsSection,SettingsTabs} from './settings-shared';

export function ToolsSettings({initialTab='web'}:{initialTab?:'web'|'computer'}){
 const [tab,setTab]=useState(initialTab);
 return <><SettingsSection title="工具管理" description="配置网页搜索、网页读取和电脑操作。"><SettingsTabs label="工具管理分类" value={tab} onChange={setTab} tabs={[{id:'web',label:'网页搜索与读取'},{id:'computer',label:'电脑操作'}]}/></SettingsSection>{tab==='web'?<WebToolsSettings/>:<CUASettings/>}</>;
}
