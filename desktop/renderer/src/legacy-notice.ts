import {createElement as h} from 'react';
/** One-time 0.3 notice for users whose 0.2 config shared services with 小K. Plain createElement so it is testable without a DOM. */
export const LEGACY_SHARED_NOTICE_TEXT='0.2 中与小K共用的服务数据不会带到 0.3，请重新设置一次服务。';
export const LEGACY_SHARED_NOTICE_ACTION='去设置';
export interface LegacyNoticeDeps{dismiss:()=>Promise<unknown>;openServices:()=>void;hide:()=>void}
/** Both actions hide the banner immediately and persist the dismissal, so it never shows again. */
export function legacyNoticeActions(deps:LegacyNoticeDeps){
 const dismiss=async()=>{deps.hide();await deps.dismiss();};
 return {goToSettings:async()=>{deps.openServices();await dismiss();},dismiss};
}
export function LegacySharedNotice({onSettings,onDismiss}:{onSettings:()=>void;onDismiss:()=>void}){
 return h('div',{className:'goal-banner legacy-shared-notice',role:'status'},
  h('span',null,LEGACY_SHARED_NOTICE_TEXT),
  h('span',{className:'legacy-shared-notice-actions'},
   h('button',{type:'button',onClick:onSettings},LEGACY_SHARED_NOTICE_ACTION),
   h('button',{type:'button','aria-label':'关闭提示',title:'关闭',onClick:onDismiss},'×')));
}
