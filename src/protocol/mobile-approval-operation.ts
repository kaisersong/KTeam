import { createHash } from "node:crypto";

/** Stable operation id for one approval. The decision is stored in the value, not this id. */
export function mobileApprovalOperationId(approvalId: string) {
  return "approval_" + createHash("sha256").update(approvalId).digest("hex").slice(0, 32);
}
