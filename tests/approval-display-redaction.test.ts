import { createHash } from "node:crypto";
import { mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateTempDir as mkdtempSync } from "./helpers/private-temp.js";
import { redactSecrets } from "../runtime-core/src/shared/stream-safety/redact.js";
import { TeamStore } from "../src/service/team-store.js";
import { ToolApprovals } from "../src/service/tool-approvals.js";

const secretInput = {
  command: "printf ok",
  password: "s3cret-value",
  token: "plain-token",
  apiKey: "key-value",
  db_password: "db-secret-value",
  user_token: "user-token-value",
  aws_secret_access_key: "aws-secret-value",
  nested: {
    api_key: "nested-key",
    token: "nested-token",
    note: "keep-visible",
    db: { db_password: "nested-db-password", user_token: "nested-user-token" },
  },
  items: [{ password: "array-secret", aws_secret_access_key: "array-aws-secret" }, { name: "visible-name" }],
};

test("host redaction hides JSON, nested and embedded secret values without treating ordinary fields as secrets", () => {
  const pretty = JSON.stringify(secretInput, null, 2);
  const redacted = redactSecrets(pretty);
  assert.equal(redacted.redacted, true);
  for (const secret of [
    "s3cret-value", "plain-token", "key-value", "nested-key", "nested-token", "array-secret",
    "db-secret-value", "user-token-value", "aws-secret-value", "nested-db-password", "nested-user-token", "array-aws-secret",
  ])
    assert.equal(redacted.text.includes(secret), false, secret);
  assert.match(redacted.text, /keep-visible/);
  assert.match(redacted.text, /visible-name/);
  assert.match(redacted.text, /printf ok/);
  const embedded = redactSecrets('curl --data \'{"password":"inline-secret","note":"keep-visible"}\'');
  assert.equal(embedded.text.includes("inline-secret"), false);
  assert.match(embedded.text, /keep-visible/);
  const counted = redactSecrets(JSON.stringify({ tokenCount: 3, note: "visible" }));
  assert.match(counted.text, /"tokenCount":3/);
  assert.match(redactSecrets("Authorization: Bearer syntheticfixturecredentialonly").text, /<redacted>/);
});

test("approval display is redacted while the tool input and original hash stay intact, and a mixed inspection rejects allow_once", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kteam-approval-redact-")));
  const config = join(root, "config");
  mkdirSync(config);
  const previous = process.env.KTEAM_MODEL_CONFIG_DIR;
  process.env.KTEAM_MODEL_CONFIG_DIR = config;
  const store = new TeamStore(root);
  const approvals = new ToolApprovals(store);
  const controller = new AbortController();
  try {
    const scope = { roomId: "room", botId: "bot", jobId: "job-secret" };
    const pendingWork = approvals.ask(scope, "bash", secretInput, controller.signal, async () => {});
    const pending = await listed(approvals, "job-secret");
    const stored = store.operation(pending.id);
    assert.deepEqual(stored.input, secretInput);
    assert.equal(
      stored.hash,
      createHash("sha256").update(JSON.stringify([scope, "bash", secretInput, pending.id])).digest("hex"),
    );
    assert.equal(pending.hash, stored.hash);
    for (const secret of [
      "s3cret-value", "plain-token", "key-value", "nested-key", "nested-token", "array-secret",
      "db-secret-value", "user-token-value", "aws-secret-value", "nested-db-password", "nested-user-token", "array-aws-secret",
    ])
      assert.equal(String(stored.display).includes(secret), false, secret);
    assert.match(stored.display, /keep-visible/);
    controller.abort();
    assert.equal(await pendingWork, false);

    const mixed = new AbortController();
    const mixedWork = approvals.ask(
      { roomId: "room", botId: "bot", jobId: "job-mixed" },
      "bash",
      { command: "ls /work && rm /work/old" },
      mixed.signal,
      async () => {},
    );
    const inspection = await listed(approvals, "job-mixed");
    assert.equal(inspection.inspectionRequired, true);
    const before = store.operation(inspection.id);
    await assert.rejects(
      approvals.decide({ id: inspection.id, expectedHash: inspection.hash, decision: "allow_once" }),
      /tool_inspection_required/,
    );
    const after = store.operation(inspection.id);
    assert.equal(after.status, "pending");
    assert.equal(after.revision, before.revision);
    assert.equal(after.hash, before.hash);
    assert.deepEqual(after.input, before.input);
    mixed.abort();
    assert.equal(await mixedWork, false);
  } finally {
    controller.abort();
    approvals.close();
    store.close();
    if (previous === undefined) delete process.env.KTEAM_MODEL_CONFIG_DIR;
    else process.env.KTEAM_MODEL_CONFIG_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

async function listed(approvals: ToolApprovals, jobId: string) {
  const until = Date.now() + 3000;
  for (;;) {
    const row = approvals.list().find((item) => item.jobId === jobId);
    if (row) return row;
    if (Date.now() > until) throw Error("expected approval");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
