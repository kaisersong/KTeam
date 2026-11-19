import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mobileConnectPlan,
  mobileConnectionFailure,
  mobileRouteLabel,
} from "../src/protocol/mobile-routes.js";

const lan = "ws://192.168.1.20:4173/mobile/connect";
const otherLan = "ws://10.0.0.8:4173/mobile/connect";
const relay = "wss://relay.example/mobile/connect?installationId=abc";
const undeclared = "wss://relay.kaihub.space/mobile/connect?installationId=abc";

test("an undeclared remembered relay is not a route and direct addresses stay first", () => {
  const plan = mobileConnectPlan(
    { endpoints: [lan, otherLan], lastEndpoint: undeclared },
    ["ws://192.168.1.30:4173/mobile/connect"],
  );
  assert.equal(plan.relay, undefined);
  assert.deepEqual(plan.addresses, [
    lan,
    otherLan,
    "ws://192.168.1.30:4173/mobile/connect",
  ]);
  assert.equal(plan.addresses.some((address) => address.includes("kaihub")), false);
  assert.equal(mobileRouteLabel(lan), "直接连接 192.168.1.20:4173");
  assert.match(mobileConnectionFailure(false, true), /直接地址/);
  assert.doesNotMatch(mobileConnectionFailure(false, true), /中继/);
});

test("a configured relay is labeled and does not replace a reachable direct address", () => {
  const plan = mobileConnectPlan({
    endpoints: [lan],
    relay,
    lastEndpoint: relay,
  });
  assert.equal(plan.relay, relay);
  assert.deepEqual(plan.addresses, [relay, lan]);
  assert.equal(mobileRouteLabel(relay, plan.relay), "远程中继 relay.example");
  assert.equal(mobileRouteLabel(lan, plan.relay), "直接连接 192.168.1.20:4173");
  assert.match(mobileConnectionFailure(true, true), /远程中继和直接连接都失败/);
  assert.match(mobileConnectionFailure(true, false), /没有可用的直接地址/);
});

test("relay credentials and fragments are not dialable", () => {
  const plan = mobileConnectPlan({
    endpoints: [lan, "ws://user:secret@192.168.1.20:4173/mobile/connect"],
    relay: "wss://user:secret@relay.example/mobile/connect",
  });
  assert.equal(plan.relay, undefined);
  assert.deepEqual(plan.addresses, [lan]);
});
