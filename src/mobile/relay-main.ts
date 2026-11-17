import { startMobileRelay } from "./relay.js";
const token = process.env.KTEAM_MOBILE_RELAY_TOKEN ?? "";
const port = Number(process.env.PORT ?? process.env.KTEAM_MOBILE_RELAY_PORT ?? 9361);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("mobile_relay_port_invalid");
const relay = await startMobileRelay(
  token,
  port,
  process.env.KTEAM_MOBILE_RELAY_BIND ?? "127.0.0.1",
);
console.log("KTeam mobile rendezvous listening on port " + relay.port);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
