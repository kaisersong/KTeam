import { createHash } from "node:crypto";
import { mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateTempDir as mkdtempSync } from "./helpers/private-temp.js";
import { redactSecrets } from "../runtime-core/src/shared/stream-safety/redact.js";
import { TeamStore } from "../src/service/team-store.js";
import { postWriteVerification } from "../src/service/post-write-verification.js";
import { sharedRuntime } from "../src/runtime/native.js";
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

const reportWorkflow = [
  "cat > /tmp/review/tail.md <<'END'",
  "rm is a literal example and > fake-output.md is document text",
  "END",
  "f=/tmp/review",
  `sed -n '9,339p' "$f/input.md" > /tmp/review/body.md`,
  `cat /tmp/review/body.md /tmp/review/tail.md > "$f/report.md"`,
  `rm -f "$f/.probe.txt" /tmp/review/probe.txt`,
  `wc -l -c "$f/report.md"; echo "--- headings:"; grep -n "^## " "$f/report.md"`,
].join("\n");

test("document verification recognition rejects inspection before removal and opaque syntax", async () => {
  const {parseCommandSegments}=await sharedRuntime();
  assert.ok(postWriteVerification(reportWorkflow,parseCommandSegments));
  for (const command of [
    "ls /tmp/review; " + reportWorkflow,
    "PATH=/tmp/review\n" + reportWorkflow,
    reportWorkflow.replace("<<'END'", "<<END"),
    reportWorkflow.replace("rm -f", "rm -rf"),
    reportWorkflow.replace('wc -l -c', '$(wc -l -c)'),
    reportWorkflow.replace("rm -f", "test /tmp/review && rm -f"),
    reportWorkflow.replace("rm -f", "bash -c 'rm -f /tmp/review/probe.txt'; rm -f"),
  ]) assert.equal(postWriteVerification(command,parseCommandSegments),undefined,command);
});

test("redacted approval keeps its input and hash, and mixed inspection permits only a bound single approval", async () => {
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
    const mixedInput = { command: 'rm -f "old fixture.txt" old.log 2>&1\necho exit=$?\nls . 2>ignored.log' };
    const mixedWork = approvals.ask(
      { roomId: "room", botId: "bot", jobId: "job-mixed", cwd: root },
      "bash",
      mixedInput,
      mixed.signal,
      async () => {},
    );
    const inspection = await listed(approvals, "job-mixed");
    assert.equal(inspection.inspectionRequired, true);
    assert.equal(inspection.highRisk, true);
    assert.equal(inspection.canAlways, false);
    assert.deepEqual(inspection.operationFacts.filter((fact:{kind:string})=>fact.kind==='delete').map((fact:{target:string})=>fact.target),
      [join(root, 'old fixture.txt'), join(root, 'old.log')]);
    const before = store.operation(inspection.id);
    for(const decision of ['allow_always','allow_directory','allow_directory_routine']){
      await assert.rejects(approvals.decide({ id: inspection.id, expectedHash: inspection.hash, decision }), /tool_permission_once_required/);
    }
    await assert.rejects(approvals.decide({ id: inspection.id, expectedHash: 'changed', decision: 'allow_once' }), /tool_approval_changed/);
    const after = store.operation(inspection.id);
    assert.equal(after.status, "pending");
    assert.equal(after.revision, before.revision);
    assert.equal(after.hash, before.hash);
    assert.deepEqual(after.input, before.input);
    assert.deepEqual(after.input, mixedInput);
    const allowOnce = { id: inspection.id, expectedHash: inspection.hash, decision: 'allow_once' };
    assert.equal((await approvals.decide(allowOnce)).status, 'allowed');
    assert.equal(await mixedWork, true);
    assert.equal((await approvals.decide(allowOnce)).reused, true);
    assert.deepEqual(approvals.permissions.list(), []);

    if(process.platform!=="win32"){
      const reportInput={command:reportWorkflow};
      const report=approvals.ask({roomId:"room",botId:"bot",jobId:"job-report",cwd:root},
        "bash",reportInput,AbortSignal.timeout(5000),async()=>{});
      const card=await listed(approvals,"job-report");
      assert.equal(card.inspectionRequired,false);
      assert.equal(card.highRisk,true);
      assert.equal(card.canAlways,false);
      const deleted=card.operationFacts.filter((fact:{kind:string})=>fact.kind==="delete").map((fact:{target:string})=>fact.target);
      assert.deepEqual(deleted,["$f/.probe.txt","/tmp/review/probe.txt"]);
      assert.deepEqual(store.operation(card.id).input,reportInput);
      const approval={id:card.id,expectedHash:card.hash};
      await assert.rejects(approvals.decide({...approval,decision:"allow_always"}),/tool_permission_once_required/);
      assert.equal((await approvals.decide({...approval,decision:"allow_once"})).status,"allowed");
      assert.equal(await report,true);
      assert.deepEqual(approvals.permissions.list(),[]);
    }
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
