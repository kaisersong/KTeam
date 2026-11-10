import {createContext,useContext,useMemo,type ReactNode} from 'react';
export interface UserProfile {displayName:string;avatarDataUrl:string}
const UserProfileContext=createContext<UserProfile>({displayName:'我',avatarDataUrl:''});
export function UserProfileProvider({profile,children}:{profile?:Partial<UserProfile>;children:ReactNode}){
 const value=useMemo(()=>({displayName:profile?.displayName||'我',avatarDataUrl:profile?.avatarDataUrl||''}),[profile?.displayName,profile?.avatarDataUrl]);
 return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}
export const useUserProfile=()=>useContext(UserProfileContext);

/** User-picked images become metadata-free, bounded square PNGs before saving. */
export async function prepareProfileAvatar(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('profile_avatar_type');
 if(file.size>10*1024*1024)throw Error('profile_avatar_too_large');
 let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('invalid_profile_avatar');}
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)throw Error('profile_avatar_too_large');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)throw Error('invalid_profile_avatar');
  const side=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,128,128);return canvas.toDataURL('image/png');
 }finally{bitmap.close();}
}
