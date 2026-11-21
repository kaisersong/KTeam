export interface SplashOpenInput {
 requestId:string;
 title?:string;
}

export interface SplashOpenResult {
 ok:true;
 opened:true;
 mode:'local';
 url:string;
 space?:{id:string;title:string};
}

export function splashTitle(value:unknown){
 if(typeof value!=='string')throw Error('splash_title_invalid');
 const title=value.trim();
 if(!title||title.length>100||/[\u0000-\u001f\u007f]/.test(title))throw Error('splash_title_invalid');
 return title;
}
