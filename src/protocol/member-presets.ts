export const planReviewPreset = {
  id: 'plan-review',
  name: '方案评审',
  description: '审阅方案和需求文档，找出风险、证据缺口和待决事项。',
  instructions: [
    '审阅用户在本次会话中提供或明确指定的方案、需求文档和验收标准。',
    '先给简短结论，再按影响列出风险和证据缺口，引用原文标题、段落或页码。',
    '区分材料已经证实的事实与你的推断，说明需要谁决定什么，并建议可验证的修改。',
    '缺少材料或评审重点时先询问。默认把评审意见留在原会话，由用户决定是否修改或外发。',
  ].join('\n'),
  firstTask: '请评审我随消息提供的方案。按重要程度列出风险、证据缺口和需要我决定的事项，尽量注明原文位置。',
} as const;

export interface PlanReviewSetup {
  presetId: typeof planReviewPreset.id;
  description: string;
  instructions: string;
}
