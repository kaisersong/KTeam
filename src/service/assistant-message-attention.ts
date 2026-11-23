import type {DailyMessageAttention} from '../protocol/assistant-daily-types.js';

const decision=/请.{0,18}(决定|确认|审核|审批|拍板|签字|核对|处理|回复|反馈)|需要.{0,12}(决定|确认|审批|签字|拍板|处理)|待(审批|确认|决策|签字)|等你(确认|决定|回复)/i;
const deadline=/截止|到期|最迟|(?:下班|下周[一二三四五六日]|今天|明天|本周五|\d{1,2}点)前.{0,16}(提交|报送|完成|回复|确认)|due by|deadline/i;
const schedule=/(?=.*(?:会议|周会|例会|日程|行程|预约|meeting))(?=.*(?:取消|改期|延后|推迟|改到|改为|调整至|提前到|rescheduled|cancelled))/i;
const resolved=/(?:已(?:经)?(?:回复|处理|解决|完成|提交|确认)|无需(?:回复|处理|确认)|不用(?:回复|处理|确认))/;
const broadcast=/@(?:all\b|所有人|全体成员)/i;
const privateCredential=/(api.?key|access.?token|app.?secret|私钥|口令|验证码|密码|密钥|证件号码|身份证号|银行卡号)/i;

export function messageText(input:unknown):string {
 if(typeof input==='string'){
  if(input.trim().startsWith('{')){
   try{const decoded=JSON.parse(input);return messageText(decoded.text??decoded.content??'');}catch{return '';}
  }
  return input.replace(/<[^>]{1,200}>/g,' ').replace(/https?:\/\/[^\s，。；！）]+/gi,'[链接]').
   replace(/[\p{Cc}\p{Cf}\s]+/gu,' ').trim().slice(0,300);
 }
 if(input&&typeof input==='object'){
  const record=input as Record<string,unknown>;
  return messageText(record.content??record.text);
 }
 return '';
}
export function messageAttention(input:{content:unknown;group:string;stamp:number;addressed?:boolean;direct?:boolean;mentionPresent?:boolean},
 redact:(text:string)=>string):DailyMessageAttention|undefined {
 const body=messageText(input.content);
 if(body.length<5||privateCredential.test(body))return;
 const general=broadcast.test(body);
 const targetsSomeone=input.mentionPresent||/@[\p{L}\p{N}]/u.test(body);
 if(!input.addressed&&!input.direct&&targetsSomeone&&!general)return;
 const text=redact(body).slice(0,180);
 if(text!==body.slice(0,180)||!text)return;
 const relevant=input.addressed||input.direct||general;
 const resolvedAt=resolved.exec(body);
 const pending=!resolvedAt||decision.test(body.slice(resolvedAt.index+resolvedAt[0].length));
 const kind=schedule.test(body)?'schedule':pending&&relevant&&deadline.test(body.replace(/截止(?:目前|现在|当前)/g,''))?'deadline':
   pending&&relevant&&decision.test(body)?'decision':pending&&(input.addressed||input.direct)&&/[?？]|请|麻烦|能否|可否|帮忙/.test(body)?'reply':undefined;
 if(!kind)return;
 return {kind,group:redact(messageText(input.group)).slice(0,70)||'原会话',text,at:input.stamp};
}
