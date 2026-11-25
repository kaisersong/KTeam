export type MailConnection = 'saved' | 'connected' | 'needs_reconnect' | 'error';
export type MailSendAccess = 'disabled' | 'reauthorize' | 'approval-required';
export type MailCapabilityAccount = { email: string; connection: MailConnection; send: MailSendAccess };
export type MailCapability = {
 host: 'available' | 'external' | 'unknown';
 member: 'allowed' | 'denied' | 'unknown';
 accounts: MailCapabilityAccount[];
};

export function mailCapabilityDescription(view: MailCapability): string {
 if(view.host==='external')return '这个成员使用外接 Agent。请在原 Agent 检查邮箱连接。';
 if(view.host==='unknown')return '暂时无法核实主机邮箱连接。请在电脑的连接器设置中刷新。';
 if(view.member==='denied')return '此成员的工具范围已停用网络。修改范围前，邮箱无法为此成员使用。';
 if(!view.accounts.length)return '尚未连接邮箱。请在电脑的连接器设置中连接账号。';
 return '账号连接与发送授权独立。发信仍需要本次审批。';
}

export const mailConnectionText: Record<MailConnection,string> = {
 saved:'已保存，连接待核验',connected:'连接已验证',needs_reconnect:'需要重新连接',error:'连接异常',
};
export const mailSendAccessText: Record<MailSendAccess,string> = {
 disabled:'发送未开启',reauthorize:'需重新授权发送','approval-required':'发送已开启，逐次审批',
};
