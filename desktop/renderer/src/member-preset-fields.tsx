import {planReviewPreset,type PlanReviewSetup} from '../../../src/protocol/member-presets';

export function MemberPresetFields({setup,disabled,onSelect,onChange}:{
 setup:PlanReviewSetup|undefined;
 disabled:boolean;
 onSelect:(active:boolean)=>void;
 onChange:(setup:PlanReviewSetup)=>void;
}){
 return <>
  <fieldset disabled={disabled} className="member-preset-options">
   <legend>成员模板</legend>
   <label className="check-label member-preset-option">
    <input type="radio" name="member-preset" checked={!setup} onChange={()=>onSelect(false)}/>
    <span><strong>自定义成员</strong></span>
   </label>
   <label className="check-label member-preset-option">
    <input type="radio" name="member-preset" checked={!!setup} onChange={()=>onSelect(true)}/>
    <span><strong>{planReviewPreset.name}</strong><small>{planReviewPreset.description}</small></span>
   </label>
  </fieldset>
  {setup&&<>
   <label>职责简介
    <input maxLength={512} required value={setup.description} disabled={disabled}
     onChange={event=>onChange({...setup,description:event.target.value})}/>
   </label>
   <label>评审要求
    <textarea rows={5} maxLength={8192} required value={setup.instructions} disabled={disabled}
     onChange={event=>onChange({...setup,instructions:event.target.value})}/>
   </label>
   <p className="form-note">创建后会在会话输入框填好第一条任务草稿。你可以补充评审重点、添加附件，再发送。</p>
  </>}
 </>;
}
