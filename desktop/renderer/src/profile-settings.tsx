import {useEffect,useRef,useState} from 'react';
import {Camera,Check,LoaderCircle} from 'lucide-react';
import {api,explain} from './api';
import {settingsAutosave} from './autosave-api';
import type {AppPreferences} from '../../../src/service/app-preferences';
import {USER_AVATAR_PRESETS,DEFAULT_USER_AVATAR,userAvatarSource} from '../../../src/user-avatars';
import {prepareProfileAvatar} from './user-profile';
import {nameImeActive,validProfileName} from './profile-name';

export function ProfileSettings({preferences,onSaved}:{preferences?:AppPreferences;onSaved:(value:AppPreferences)=>void}){
 const [base,setBase]=useState<AppPreferences>(),[name,setName]=useState(''),[avatar,setAvatar]=useState('');
 const [loading,setLoading]=useState(true),[pending,setPending]=useState(0),[processing,setProcessing]=useState(false),[error,setError]=useState(''),[generation,setGeneration]=useState(0);
 const input=useRef<HTMLInputElement>(null),imageGeneration=useRef(0),alive=useRef(true),lastPatch=useRef<Record<string,unknown>>({});
 const baseRef=useRef<AppPreferences|undefined>(undefined),nameRef=useRef(''),focused=useRef(false),dirty=useRef(false),composing=useRef(false);
 const nameWrites=useRef(0),lastNameWrite=useRef<string|undefined>(undefined),nameVersion=useRef(0);
 const displayName=(value:string)=>{nameRef.current=value;setName(value);};
 const adoptBase=(value:AppPreferences)=>{if(!baseRef.current||value.revision>=baseRef.current.revision){baseRef.current=value;setBase(value);}};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;imageGeneration.current++;};},[]);
 useEffect(()=>{let current=true;setLoading(true);setError('');void api.appPreferences().then(r=>{if(!current)return;const latest=baseRef.current&&baseRef.current.revision>r.preferences.revision?baseRef.current:r.preferences;adoptBase(latest);if(!focused.current&&!dirty.current)displayName(latest.displayName);setAvatar(latest.avatarDataUrl);}).catch(e=>{if(current)setError(explain(e));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[generation]);
 useEffect(()=>{const previous=baseRef.current;if(!preferences||previous&&preferences.revision<=previous.revision)return;adoptBase(preferences);if(!focused.current&&!dirty.current&&!composing.current)displayName(preferences.displayName);setAvatar(current=>!previous||current===previous.avatarDataUrl?preferences.avatarDataUrl:current);},[preferences]);
 async function save(patch:Record<string,unknown>){
  const submittedVersion=nameVersion.current;lastPatch.current=patch;setPending(n=>n+1);setError('');
  try{const result=await settingsAutosave.preferences(patch);onSaved(result.preferences);if(alive.current){adoptBase(result.preferences);if(patch.useSystemName&&nameVersion.current===submittedVersion){dirty.current=false;displayName(result.preferences.displayName);}else if(typeof patch.displayName==='string'&&nameRef.current.trim()===patch.displayName.trim()){dirty.current=false;if(!focused.current&&!composing.current)displayName(result.preferences.displayName);}}return true;}
  catch(e){if(alive.current){setError((patch.displayName!==undefined?'用户名未能保存：':'资料未能保存：')+explain(e));}return false;}
  finally{if(alive.current)setPending(n=>n-1);}
 }
 async function saveName(value=nameRef.current){
  if(!baseRef.current||composing.current||nameWrites.current)return;
  if(!validProfileName(value)){lastPatch.current={displayName:value};setError('名字需要 1–40 个字符，不能包含控制字符');return;}
  const normalized=value.trim();
  if(!nameWrites.current&&normalized===baseRef.current.displayName){dirty.current=false;setError('');if(!focused.current)displayName(normalized);return;}
  if(nameWrites.current&&lastNameWrite.current===normalized)return;
  lastNameWrite.current=normalized;nameWrites.current++;
  try{await save({displayName:normalized});}finally{nameWrites.current--;if(!nameWrites.current)lastNameWrite.current=undefined;}
 }
 function editName(value:string){if(nameRef.current===value)return;nameVersion.current++;displayName(value);dirty.current=true;setError('');}
 async function choose(file?:File){if(!file)return;const sequence=++imageGeneration.current;setProcessing(true);setError('');try{const next=await prepareProfileAvatar(file);if(alive.current&&sequence===imageGeneration.current){setAvatar(next);setProcessing(false);void save({avatarDataUrl:next});}}catch(e){if(alive.current&&sequence===imageGeneration.current)setError(explain(e));}finally{if(alive.current&&sequence===imageGeneration.current)setProcessing(false);}}
 function choosePreset(dataUrl:string){imageGeneration.current++;setProcessing(false);const value=dataUrl===DEFAULT_USER_AVATAR.dataUrl?'':dataUrl;setAvatar(value);void save({avatarDataUrl:value});}
 const avatarBusy=processing||pending>0;
 return <section className="settings-block profile-settings"><h2>个人资料</h2><p className="settings-description">设置你在消息和群成员中显示的名字与头像。</p>{loading?<p className="settings-loading" role="status"><LoaderCircle size={16} className="spinner"/>正在读取个人资料…</p>:<>
  <div className="profile-picture-row"><div className="profile-picture" role="img" aria-label="头像预览"><img src={userAvatarSource(avatar)} alt=""/></div><div><div className="profile-picture-actions"><button type="button" className="secondary" disabled={avatarBusy||!base} onClick={()=>input.current?.click()}><Camera size={15}/>{processing?'正在处理…':'上传图片'}</button>{avatar&&!USER_AVATAR_PRESETS.some(p=>p.dataUrl===avatar)&&<button type="button" className="text-link" disabled={avatarBusy} onClick={()=>choosePreset(DEFAULT_USER_AVATAR.dataUrl)}>恢复默认头像</button>}</div><p className="settings-description">支持 PNG、JPG、WebP，最大 10 MB。仅保存在本机。</p></div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择头像图片" hidden onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void choose(file);}}/></div>
  <fieldset className="profile-avatar-presets" disabled={avatarBusy||!base}><legend>选择头像</legend><div className="profile-avatar-options">{USER_AVATAR_PRESETS.map((preset,index)=>{const selected=userAvatarSource(avatar)===preset.dataUrl;return <button key={preset.id} type="button" className="profile-avatar-option" aria-label={'选择头像 '+(index+1)} aria-pressed={selected} onClick={()=>choosePreset(preset.dataUrl)}><span><img src={preset.dataUrl} alt=""/>{selected&&<Check size={13} className="profile-avatar-check"/>}</span></button>;})}</div></fieldset>
  <div className="settings-field profile-name"><label htmlFor="profile-display-name">你的名字</label><div><input id="profile-display-name" aria-label="用户名字" autoComplete="off" value={name} maxLength={80} placeholder="输入你的名字" disabled={!base}
   onFocus={()=>{focused.current=true;}} onInput={e=>editName(e.currentTarget.value)} onChange={e=>editName(e.currentTarget.value)}
   onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={e=>{composing.current=false;editName(e.currentTarget.value);}}
   onBlur={e=>{focused.current=false;editName(e.currentTarget.value);}}
   onKeyDown={e=>{if(e.key==='Enter'&&!nameImeActive(e.nativeEvent,composing.current)){e.preventDefault();}}}/><button type="button" className="secondary profile-name-save" aria-label="保存用户名" disabled={!base||nameWrites.current>0||!validProfileName(name)||name.trim()===base.displayName} onClick={()=>void saveName(nameRef.current)}>{nameWrites.current>0?<LoaderCircle size={14} className="spinner"/>:'保存'}</button><small>{Array.from(name).length} / 40</small></div></div>
  {base?.displayNameSource==='custom'&&<button type="button" className="text-link" onClick={()=>{lastNameWrite.current=undefined;nameWrites.current++;void save({useSystemName:true}).finally(()=>{nameWrites.current--;if(!nameWrites.current)lastNameWrite.current=undefined;});}}>使用系统名字</button>}
  {error&&<div className="settings-error" role="alert"><p>{error}</p><button type="button" className="secondary" disabled={!!pending} onClick={()=>typeof lastPatch.current.displayName==='string'?void saveName():void save(lastPatch.current)}>重试保存</button><button type="button" className="secondary" disabled={!!pending||processing} onClick={()=>setGeneration(v=>v+1)}>重新读取个人资料</button></div>}

 </>}</section>;
}
