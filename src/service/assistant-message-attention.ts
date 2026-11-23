import type {DailyMessageAttention} from '../protocol/assistant-daily-types.js';

const decision=/请.{0,18}(决定|确认|审核|审批|拍板|签字|核对|处理|回复|反馈)|需要.{0,12}(决定|确认|审批|签字|拍板|处理)|待(审批|确认|决策|签字)|等你(确认|决定|回复)/i;
const deadline=/截止|到期|最迟|(?:下班|下周[一二三四五六日]|今天|明天|本周五|\d{1,2}点)前.{0,16}(提交|报送|完成|回复|确认)|due by|deadline/i;
const schedule=/(?=.*(?:会议|周会|例会|日程|行程|预约|meeting))(?=.*(?:取消|改期|延后|提前|改到|调整至|推迟|rescheduled|cancelled))/i;
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
export function messageAttention(input:{content:unknown;group:string;stamp:number;addressed?:boolean;direct?:boolean},
 redact:(text:string)=>string):DailyMessageAttention|undefined {
 const body=messageText(input.content);
 if(body.length<5||privateCredential.test(body))return;
 const text=redact(body).slice(0,180);
 if(text!==body.slice(0,180)||!text)return;
 const kind=schedule.test(body)?'schedule':deadline.test(body)?'deadline':decision.test(body)?'decision':
   input.addressed||input.direct?'reply':undefined;
 if(!kind)return;
 return {kind,group:redact(messageText(input.group)).slice(0,70)||'原会话',text,at:input.stamp};
}
