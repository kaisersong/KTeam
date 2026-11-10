import {memo,useEffect,useRef,useState} from 'react';
import {UserRound} from 'lucide-react';
import {botFamily,botAvatarSource,botAngle,workingBotAngle,type BotAppearanceIdentity} from '../../../src/bot-appearance';
import {observeWorkingAvatar} from './avatar-motion';

/** Original angle artwork; only visible live-work avatars opt into the shared motion clock. */
export const Avatar=memo(function Avatar({name,id,description,isAssistant,human=false,expressive=false,front=false,working=false}:BotAppearanceIdentity&{human?:boolean;expressive?:boolean;front?:boolean;working?:boolean}){
 const identity={name,id,description,isAssistant},family=botFamily(identity),target=useRef<HTMLSpanElement>(null);
 const [motion,setMotion]=useState({animated:false,step:0}),lively=working&&!human;
 useEffect(()=>{if(!lively||!target.current){setMotion(previous=>previous.animated?{animated:false,step:0}:previous);return;}return observeWorkingAvatar(target.current,next=>setMotion(previous=>previous.animated===next.animated&&previous.step===next.step?previous:next));},[lively]);
 const base=front?'front':botAngle(identity),angle=motion.animated?workingBotAngle(base,motion.step,isAssistant||family==='k'):base;
 const source=botAvatarSource(family,{angle,animated:lively&&motion.animated});
 return <span ref={target} className={'avatar '+(human?'human-avatar':'bot-avatar')} role="img" aria-label={human?'我':name+'的头像'+(working?'，正在工作':'')} data-family={human?undefined:family} data-angle={human?undefined:angle} data-working={lively?'true':undefined} data-animated={lively&&motion.animated?'true':undefined}>{human?<UserRound size={18}/>:<img key={source} src={source} alt="" draggable={false}/>}</span>;
});
