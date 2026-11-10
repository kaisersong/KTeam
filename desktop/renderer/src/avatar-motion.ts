// One clock/observer for visible working avatars. History has no timers or observers.
type Entry={visible:boolean;notify:(state:{animated:boolean;step:number})=>void};
const entries=new Map<Element,Entry>();let observer:IntersectionObserver|undefined,timer:ReturnType<typeof setInterval>|undefined,motion:MediaQueryList|undefined,step=0;
function permitted(){return document.visibilityState==='visible'&&document.hasFocus()&&!motion?.matches;}
function update(){const active=permitted();for(const entry of entries.values())entry.notify({animated:active&&entry.visible,step:active&&entry.visible?step:0});const ticking=active&&[...entries.values()].some(e=>e.visible);if(ticking&&!timer)timer=setInterval(()=>{step++;update();},3200);else if(!ticking&&timer){clearInterval(timer);timer=undefined;}}
export function observeWorkingAvatar(element:Element,notify:Entry['notify']){
 if(!entries.size){motion=window.matchMedia('(prefers-reduced-motion: reduce)');motion.addEventListener('change',update);document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);window.addEventListener('blur',update);observer=new IntersectionObserver(changes=>{for(const change of changes){const entry=entries.get(change.target);if(entry)entry.visible=change.isIntersecting;}update();});}
 entries.set(element,{visible:false,notify});observer!.observe(element);update();
 return()=>{observer?.unobserve(element);entries.delete(element);if(!entries.size){observer?.disconnect();observer=undefined;if(timer)clearInterval(timer);timer=undefined;motion?.removeEventListener('change',update);motion=undefined;document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);window.removeEventListener('blur',update);}else update();};
}
