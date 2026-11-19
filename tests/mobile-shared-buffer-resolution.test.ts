import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const mobile = join(root, "mobile");
const shared = join(root, "src/protocol/mobile-wire.ts");
const rootModules = join(root, "node_modules");
const mobileRequire = createRequire(join(mobile, "package.json"));
// Root `npm ci` does not install mobile/package-lock.json. Load the pinned mobile
// tree before resolving its toolchain; otherwise this file exits before either assertion.
const pinnedMobileModules = ["metro-resolver/package.json", "typescript/package.json", "buffer/package.json", "expo/package.json", "expo/metro-config.js", "expo/tsconfig.base.json"];
const mobilePackage = (rel: string) => join(mobile, "node_modules", rel);
if (!pinnedMobileModules.every(rel => existsSync(mobilePackage(rel)))) {
  const installed = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {cwd: mobile, stdio: "inherit"});
  if (installed.error) throw installed.error;
  if (installed.status !== 0) throw Object.assign(Error("mobile_install_failed"), {status: installed.status, signal: installed.signal});
  if (!pinnedMobileModules.every(rel => existsSync(mobilePackage(rel)))) throw Error("mobile_install_incomplete");
}
const ts = mobileRequire("typescript") as {
  readConfigFile: (file: string, read: (file: string) => string | undefined) => { config: { compilerOptions?: object }; error?: unknown };
  sys: {
    useCaseSensitiveFileNames: boolean;
    readDirectory: (...args: unknown[]) => string[];
    fileExists: (file: string) => boolean;
    readFile: (file: string) => string | undefined;
    directoryExists?: (dir: string) => boolean;
    realpath?: (path: string) => string;
  };
  parseJsonConfigFileContent: (config: object, host: object, base: string, existing: undefined, path: string) => { options: object };
  resolveModuleName: (name: string, file: string, options: object, host: object) => { resolvedModule?: { resolvedFileName: string } };
};
const { resolve } = mobileRequire("metro-resolver") as {
  resolve: (context: object, specifier: string, platform: string) => { type: string; filePath: string };
};

function hidesRootInstall(file: string) {
  return file === rootModules || file.startsWith(rootModules + sep);
}

test("mobile typecheck resolves buffer from the mobile install when the root install is absent", () => {
  const configPath = join(mobile, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const host = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: (file: string) => !hidesRootInstall(file) && ts.sys.fileExists(file),
    readFile: (file: string) => (hidesRootInstall(file) ? undefined : ts.sys.readFile(file)),
  };
  const parsed = ts.parseJsonConfigFileContent(read.config, host, mobile, undefined, configPath);
  const resolutionHost = {
    fileExists: host.fileExists,
    readFile: host.readFile,
    directoryExists: (dir: string) => !hidesRootInstall(dir) && (ts.sys.directoryExists?.(dir) ?? false),
    realpath: ts.sys.realpath,
  };
  const resolved = ts.resolveModuleName("buffer", shared, parsed.options, resolutionHost);
  const file = resolved.resolvedModule?.resolvedFileName;
  assert.equal(file && realpathSync(file), realpathSync(join(mobile, "node_modules/buffer/index.d.ts")));
  assert.match(readFileSync(file!, "utf8"), /export class Buffer/);
});

test("metro resolves the shared wire file's buffer runtime from the mobile install", () => {
  const config = mobileRequire("./metro.config.js") as {
    resolver: { nodeModulesPaths: string[]; resolveRequest?: (context: object, name: string, platform: string) => unknown; extraNodeModules?: Record<string, string> };
  };
  const lookup = (file: string) => {
    if (hidesRootInstall(file)) return { exists: false };
    try {
      const stat = statSync(file);
      return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(file) };
    } catch {
      return { exists: false };
    }
  };
  const resolved = resolve({
    originModulePath: shared,
    nodeModulesPaths: config.resolver.nodeModulesPaths,
    disableHierarchicalLookup: false,
    extraNodeModules: config.resolver.extraNodeModules ?? {},
    mainFields: ["react-native", "browser", "main"],
    sourceExts: ["ts", "tsx", "mjs", "js", "jsx", "json", "cjs"],
    assetExts: new Set(["png"]),
    preferNativePlatform: true,
    unstable_enablePackageExports: true,
    unstable_conditionNames: ["react-native", "require", "import", "default"],
    unstable_conditionsByPlatform: { ios: ["react-native"] },
    allowHaste: false,
    resolveHasteModule: () => null,
    resolveHastePackage: () => null,
    doesFileExist: (file: string) => lookup(file).type === "f",
    fileSystemLookup: lookup,
    getPackage: (file: string) => JSON.parse(readFileSync(file, "utf8")),
    getPackageForModule: () => null,
    resolveRequest: config.resolver.resolveRequest,
    unstable_logWarning: () => {},
  }, "buffer", "ios");
  assert.equal(resolved.type, "sourceFile");
  assert.equal(realpathSync(resolved.filePath), realpathSync(join(mobile, "node_modules/buffer/index.js")));
  const runtime = mobileRequire(resolved.filePath) as { Buffer: { from: (value: string, encoding: string) => { toString: () => string } } };
  assert.equal(runtime.Buffer.from("YQ==", "base64").toString(), "a");
  assert.equal(existsSync(join(dirname(resolved.filePath), "package.json")), true);
});
