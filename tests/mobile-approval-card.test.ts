import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileApprovalCard } from "../src/protocol/mobile-approval-card.js";

const approval = {
  id: "tool-approval:one",
  toolName: "bash",
  reason: "此命令需要单次确认：包含删除。",
  highRisk: true,
  riskTags: ["terminal-confirmation"],
  inspectionRequired: false,
  operationFacts: [{ kind: "delete", target: "build/old", reason: "删除" }],
  display: '{"command":"rm build/old","token":"[redacted]"}',
  directory: "/work/app",
  directories: ["/work/app"],
  expiresAt: Date.parse("2026-11-19T16:00:00.000Z"),
  hash: "abc123",
  canAlways: true,
};

test("a phone approval card shows the host fields and keeps the original hash", () => {
  const card = mobileApprovalCard(approval);
  assert.equal(card.toolName, "bash");
  assert.equal(card.reason, approval.reason);
  assert.equal(card.risk, "高风险，需要单独确认");
  assert.deepEqual(card.targets, [{ label: "删除或清空", target: "build/old" }]);
  assert.equal(card.parameters, approval.display);
  assert.match(card.parameters, /\[redacted\]/);
  assert.deepEqual(card.directories, ["/work/app"]);
  assert.equal(card.expiresAt, approval.expiresAt);
  assert.equal(card.hash, "abc123");
  assert.deepEqual(card.decisions, ["deny", "allow_once"]);
});

test("a mixed inspection shows the full-command warning and allows one bound approval", () => {
  const card = mobileApprovalCard({
    ...approval,
    inspectionRequired: true,
    highRisk: false,
    riskTags: ["sensitive-access"],
    hash: "bound-hash",
    display: "",
  });
  assert.deepEqual(card.decisions, ["deny", "allow_once"]);
  assert.match(card.inspection ?? "", /允许本次将执行完整命令/);
  assert.equal(card.risk, "sensitive-access");
  assert.equal(card.hash, "bound-hash");
  assert.equal(card.parameters, "");
  assert.equal(JSON.stringify(card).includes("allow_always"), false);
  assert.equal(JSON.stringify(card).includes("allow_conversation"), false);
});
