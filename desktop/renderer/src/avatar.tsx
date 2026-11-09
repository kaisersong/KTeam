import {memo,useEffect,useRef,useState} from 'react';
import {UserRound} from 'lucide-react';
import {botFamily,botAvatarSource,type BotAppearanceIdentity} from '../../../src/bot-appearance';

/** History/list avatars stay static. Only the visible current conversation opts into motion. */
export const Avatar=memo(function Avatar({name,id,description,isAssistant,human=false,expressive=false,front=false}:BotAppearanceIdentity&{human?:boolean;expressive?:boolean;front?:boolean}){
 const family=botFamily({name,id,description,isAssistant}),target=useRef<HTMLSpanElement>(null);
 const [animated,setAnimated]=useState(false);
 const lively=expressive&&!human&&family==='k';
 useEffect(()=>{
  if(!lively){setAnimated(false);return;}
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');let visible=false;
  const update=()=>setAnimated(visible&&document.visibilityState==='visible'&&!motion.matches);
  const observer=new IntersectionObserver(entries=>{visible=!!entries[0]?.isIntersecting;update();});
  if(target.current)observer.observe(target.current);
  motion.addEventListener('change',update);document.addEventListener('visibilitychange',update);
  return()=>{observer.disconnect();motion.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);};
 },[lively]);
 return <span ref={target} className={'avatar '+(human?'human-avatar':'bot-avatar')} role="img" aria-label={human?'我':name+'的头像'} data-family={human?undefined:family} data-animated={lively&&animated?'true':undefined}>{human?<UserRound size={18}/>:<img src={botAvatarSource(family,{expressive:lively,animated:lively&&animated,front})} alt="" draggable={false}/>}</span>;
});
