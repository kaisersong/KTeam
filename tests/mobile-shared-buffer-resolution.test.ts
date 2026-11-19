import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const mobile = join(root, "mobile");
const shared = join(root, "src/protocol/mobile-wire.ts");
const rootModules = join(root, "node_modules");
const mobileRequire = createRequire(join(mobile, "package.json"));
const { requireFromMobileInstall } = await import(pathToFileURL(join(root, "scripts/mobile-install.mjs")).href) as {
  requireFromMobileInstall: (mobile: string, specifier: string) => any;
};
function toolchain(){
  return {
    ts: requireFromMobileInstall(mobile, "typescript") as {
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
},
    resolve: (requireFromMobileInstall(mobile, "metro-resolver") as {
      resolve: (context: object, specifier: string, platform: string) => { type: string; filePath: string };
    }).resolve,
  };
}

function hidesRootInstall(file: string) {
  return file === rootModules || file.startsWith(rootModules + sep);
}

test("mobile typecheck resolves buffer from the mobile install when the root install is absent", () => {
  const { ts } = toolchain();
  requireFromMobileInstall(mobile, "buffer/package.json");
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
  const { resolve } = toolchain();
  requireFromMobileInstall(mobile, "expo/metro-config");
  requireFromMobileInstall(mobile, "buffer/package.json");
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
