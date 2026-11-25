const reasons = {
 mention: '用户明确提及成员',
 reply: '用户引用了成员的消息',
 explicit: '用户在消息开头指定成员',
 passive: '普通群消息，由现有路由判断',
 handoff: '来自已登记的工作交接',
 recovery: '恢复原工作',
 routine: '由用户设定的例行任务或试运行触发',
 followup: '由原工作的跟进安排触发',
 passiveAgent: '普通成员消息，命中静默试验条件',
 acknowledgement: '宿主识别出无后续事项的确认',
} as const;

export interface WorkDispatchEvidence {
 reason: keyof typeof reasons;
 sourceSequence?: number;
}

export function dispatchEvidenceView(value: unknown): WorkDispatchEvidence | undefined {
 if(!value||typeof value!=='object')return;
 const {reason,sourceSequence}=value as WorkDispatchEvidence;
 if(!Object.hasOwn(reasons,reason))return;
 return {reason,...(Number.isSafeInteger(sourceSequence)&&sourceSequence!>0?{sourceSequence}:{})};
}

export function dispatchEvidenceText(value: unknown): string | undefined {
 const evidence=dispatchEvidenceView(value);
 if(!evidence)return;
 return reasons[evidence.reason]+(evidence.sourceSequence?' · 触发消息序号 '+evidence.sourceSequence:'');
}
