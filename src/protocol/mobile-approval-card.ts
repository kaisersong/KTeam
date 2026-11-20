/** Presentation of a host approval record. The hash is the host's expectedHash and is not recomputed here. */
export type MobileApprovalView = {
  toolName: string;
  reason?: string;
  risk?: string;
  inspection?: string;
  targets: { label: string; target: string }[];
  parameters: string;
  directories: string[];
  expiresAt?: number;
  decisions: Array<"deny" | "allow_once">;
  hash: string;
};

const targetLabel = (kind: unknown) =>
  kind === "delete" ? "删除或清空" : kind === "overwrite" ? "写入或覆盖" : "目标待核对";

export function mobileApprovalCard(approval: {
  toolName?: unknown;
  reason?: unknown;
  highRisk?: unknown;
  riskTags?: unknown;
  inspectionRequired?: unknown;
  operationFacts?: unknown;
  display?: unknown;
  directory?: unknown;
  directories?: unknown;
  expiresAt?: unknown;
  hash?: unknown;
}): MobileApprovalView {
  const facts = Array.isArray(approval.operationFacts) ? approval.operationFacts : [];
  const directories = Array.isArray(approval.directories) && approval.directories.length
    ? approval.directories.filter((value): value is string => typeof value === "string")
    : typeof approval.directory === "string"
      ? [approval.directory]
      : [];
  const tags = Array.isArray(approval.riskTags)
    ? approval.riskTags.filter((value): value is string => typeof value === "string")
    : [];
  return {
    toolName: typeof approval.toolName === "string" && approval.toolName ? approval.toolName : "操作",
    reason: typeof approval.reason === "string" ? approval.reason : undefined,
    risk: approval.highRisk === true ? "高风险，需要单独确认" : tags.length ? tags.join("、") : undefined,
    inspection: approval.inspectionRequired === true
      ? "检查与删除混在同一条命令。请拒绝这次申请，让成员先单独检查，再提交修改。"
      : undefined,
    targets: facts.flatMap((fact) => {
      if (!fact || typeof fact !== "object") return [];
      const target = (fact as { target?: unknown }).target;
      if (typeof target !== "string" || !target) return [];
      return [{ label: targetLabel((fact as { kind?: unknown }).kind), target }];
    }),
    parameters: typeof approval.display === "string" ? approval.display : "",
    directories,
    expiresAt: typeof approval.expiresAt === "number" && Number.isFinite(approval.expiresAt)
      ? approval.expiresAt
      : undefined,
    decisions: approval.inspectionRequired === true ? ["deny"] : ["deny", "allow_once"],
    hash: typeof approval.hash === "string" ? approval.hash : "",
  };
}
