import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const out = resolve(process.argv[2] ?? "release/mobile-relay");
await mkdir(out, { recursive: true });
const source = await readFile("src/mobile/relay-main.ts", "utf8");
await build({
  stdin: {
    loader: "ts",
    resolveDir: resolve("src/mobile"),
    contents: 'import {startMobileRelay} from "./relay.js"; (async()=>{' +
      source.replace('import { startMobileRelay } from "./relay.js";', "") +
      '})().catch(() => { console.error("Mobile relay startup failed"); process.exit(1); });',
  },
  outfile: resolve(out, "relay.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node24",
});
await writeFile(resolve(out, "Dockerfile"), `FROM node:24-alpine
WORKDIR /app
COPY relay.cjs ./relay.cjs
ENV PORT=9000 KTEAM_MOBILE_RELAY_BIND=0.0.0.0
EXPOSE 9000
USER node
CMD ["node", "relay.cjs"]
`);
await writeFile(resolve(out, ".dockerignore"), "*\n!relay.cjs\n!Dockerfile\n");
console.log("Relay deployment bundle ready (supply KTEAM_MOBILE_RELAY_TOKEN at runtime)");
