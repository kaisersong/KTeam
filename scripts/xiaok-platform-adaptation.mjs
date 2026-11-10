import {adaptKTeamConfig} from './kteam-config-adaptation.mjs';
import {readFileSync} from 'node:fs';
// Build-time, checked seams. Vendored files remain byte-identical to the pinned commit.
// No xiaok team store is created: KTeam keeps KSwarm/Intent Broker authoritative.
export function adaptPlatformSource(path,source){
 let text=adaptKTeamConfig(path,source.replaceAll('\r\n','\n'));
 const replace=(from,to)=>{if(!text.includes(from))throw Error('xiaok_adaptation_basis_changed:'+path+':'+from.slice(0,60));text=text.replace(from,to);};
 if(path.endsWith('/ai/runtime/agent-runtime.ts')){
  replace('private readonly memoryStore?: MemoryStore;', 'private readonly memoryStore?: MemoryStore;\n  private readonly checkpoint?: () => Promise<void>;\n  private readonly spillDir?: string;');
  replace('this.memoryStore = options.memoryStore;', 'this.memoryStore = options.memoryStore; this.checkpoint=options.checkpoint;this.spillDir=options.spillDir;');
  replace("onEvent({ type: 'model_request_started', runId: run.runId });", "await this.checkpoint?.();\n        onEvent({ type: 'model_request_started', runId: run.runId });");
  replace('const toolCalls = currentAssistantBlocks.filter', 'await this.checkpoint?.();\n        const toolCalls = currentAssistantBlocks.filter');
  replace('this.session.appendUserToolResults(toolResults);\n        toolResults = [];', 'this.session.appendUserToolResults(toolResults);\n        toolResults = [];\n        await this.checkpoint?.();');
  replace("spillDir: join(sessionSnapshot.cwd, '.xiaok', 'spill'),", "spillDir: this.spillDir ?? join(sessionSnapshot.cwd, '.xiaok', 'spill'),");
 }
 if(path.endsWith('/ai/tools/read.ts')){
  text="import {extractPdfText} from '../../../desktop/electron/pdf-text.js';\n"+text;
  replace("        if (kind === 'pdf') {\n          return 'Error: 无法以文本方式读取 PDF。请把它作为附件交给 Desktop 的 read_material，或先转换为文本。';\n        }\n", '');
  replace("if (kind === 'ooxml') {", "if (kind === 'ooxml' || kind === 'pdf') {");
  replace("            mimeType: '',", "            mimeType: kind === 'pdf' ? 'application/pdf' : '', pdfToText:extractPdfText,");
 }
 if(path.endsWith('/electron/pdf-text.ts')){
  text="import {createRequire as pdfRequire} from 'node:module';import {dirname as pdfDirname,join as pdfJoin} from 'node:path';\n"+text;
  replace('const loadingTask = pdfjsLib.getDocument({ data: bytes });', "const pdfRoot=pdfDirname(pdfRequire(import.meta.url).resolve('pdfjs-dist/package.json')); const loadingTask = pdfjsLib.getDocument({data:bytes,isEvalSupported:false,standardFontDataUrl:pdfJoin(pdfRoot,'standard_fonts')+'/',cMapUrl:pdfJoin(pdfRoot,'cmaps')+'/',cMapPacked:true,wasmUrl:pdfJoin(pdfRoot,'wasm')+'/'});");
 }
 if(path.endsWith('/tools/install-skill.ts')){
  replace("import { execSync } from 'child_process';", "import { execFile } from 'child_process';");
  replace('function cloneSkillRepo(', 'async function cloneSkillRepo(');
  replace('const result = cloneSkillRepo(resolvedSource.location, skillDir);', 'const result = await cloneSkillRepo(resolvedSource.location, skillDir);');
  const start=text.indexOf('    execSync(`git clone '),end=text.indexOf('    // 检查是否有 setup',start);
  if(start<0||end<0)throw Error('xiaok_skill_clone_basis_changed');
  text=text.slice(0,start)+`    await new Promise((resolve,reject)=>execFile('git',['clone','--single-branch','--depth','1',repoUrl,skillDir],{timeout:60000},error=>error?reject(error):resolve()));\n\n`+text.slice(end);
 }
 if(path.endsWith('/runtime/hooks-runner.ts')){
  replace('        executedOnce.add(hookKey);','        // Mark only after current-scope admission succeeds.');
  replace('      const timeout = hook.timeoutMs ?? defaultTimeout;', `      try { await config.assertCurrent?.(); } catch (error) {
        const code = typeof error?.code === 'string' && /^[a-z0-9_-]{1,96}$/.test(error.code) ? error.code : 'scope_check_failed';
        return {ok:false,message:'harness_scope_check_failed:'+code+'。当前执行环境校验未通过；不能据此判定其他成员离线或授权已撤销。'};
      }
      if (hook.once) {
        if (executedOnce.has(hookKey)) continue;
        executedOnce.add(hookKey);
      }
      const timeout = hook.timeoutMs ?? defaultTimeout;`);
 }
 if(path.endsWith('/permissions/policy-engine.ts')){
  replace('function shellWords(text: string): string[] {','export function shellWords(text: string): string[] {');
 }
 if(path.endsWith('/worktrees/manager.ts')){
  replace("import { execFileSync, spawnSync } from 'node:child_process';", "import { execFileSync, execFile } from 'node:child_process';");
  replace("      'ps',", "      '/bin/ps',");
  const start=text.indexOf("  const result = spawnSync('lsof', ['+D', path], {");
  const end=text.indexOf('\n}\n\nfunction readProcessStartToken',start);
  if(start<0||end<0)throw Error('xiaok_worktree_gc_basis_changed');
  text=text.slice(0,start)+`  return await new Promise(resolve => execFile(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof', ['+D', path], {encoding:'utf8',timeout:10000,maxBuffer:1024*1024}, (error,stdout,stderr) => {
    if(!error)return resolve(stdout.trim() ? 'used' : 'unknown');
    resolve(error.code === 1 && !stdout.trim() && !stderr.trim() ? 'free' : 'unknown');
  }));`+text.slice(end);
 }
 if(path.endsWith('/plugins/runtime.ts')){
  replace('dispose: () => client.dispose(),', `dispose: () => client.dispose(),
    close: async () => { client.dispose(); processHandle.dispose(); const child = processHandle.child; if(child.exitCode !== null || child.signalCode !== null)return; await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('lsp_shutdown_unconfirmed'));},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});}); },`);
 }
 if(path.endsWith('/memory/layered-store.ts')){
  replace('this.embeddingClient = new EmbeddingClient(this.db, embeddingConfig);', `this.db.exec('CREATE TABLE IF NOT EXISTS kteam_embedding_profile(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    const embeddingProfile=JSON.stringify(embeddingConfig);
    if(this.db.prepare('SELECT value FROM kteam_embedding_profile WHERE id=1').get()?.value!==embeddingProfile)this.db.transaction(()=>{this.db.exec('DELETE FROM memory_embeddings');this.db.prepare('INSERT OR REPLACE INTO kteam_embedding_profile VALUES(1,?)').run(embeddingProfile);})();
    this.embeddingClient = new EmbeddingClient(this.db, embeddingConfig);`);
 }
 if(path.endsWith('/memory/embedding.ts')){
  replace("method: 'POST',", "method: 'POST',signal:AbortSignal.timeout(15000),");
 }
 if(path.endsWith('/connectors/registry.ts')){
  replace("apiKey: config.fetch.firecrawlApiKey?.trim() || undefined,", "apiKey: config.fetch.firecrawlApiKey?.trim() || undefined,endpoint:config.fetch.firecrawlBaseUrl ? config.fetch.firecrawlBaseUrl.replace(/\\/$/,'')+'/v2/scrape' : undefined,");
 }
 if(path.endsWith('/runtime/context.ts')){
  replace('const settingsMcpServers = loadSettingsMcpServers();','const settingsMcpServers = options.kteamMcpServers ?? loadSettingsMcpServers();');
  replace('const pluginMcpServers = loadPluginMcpServers(pluginRuntime);',"const pluginMcpServers = [...loadPluginMcpServers(pluginRuntime),...(options.kteamCuaServer ? [{...options.kteamCuaServer,name:'cua-driver',source:{origin:'plugin',pluginName:'cua-computer-use'},requiresUserActivation:true}] : [])];");
  replace('const customAgents = await loadCustomAgents(undefined, options.cwd, pluginRuntime.agentDirs);', 'const customAgents = await loadCustomAgents(undefined, options.cwd, pluginRuntime.agentDirs); await options.assertCurrent?.();');
  replace('connectWorkspaceLspServers(pluginRuntime, lspManager, options.cwd, capabilityHealth, disposables)', 'connectWorkspaceLspServers(pluginRuntime, lspManager, options.cwd, capabilityHealth, disposables, options.assertCurrent)');
  replace('disposables: Array<{ dispose(): void }>,\n): Promise<LspClientLike', 'disposables: Array<{ dispose(): void }>,\n  assertCurrent?: () => Promise<void>,\n): Promise<LspClientLike');
  replace('const connection = await connectDeclaredLspServer(declaration, lspManager, rootUri);', 'await assertCurrent?.();\n      const connection = await connectDeclaredLspServer(declaration, lspManager, rootUri);');
  replace("activity?: Parameters<PlatformRuntimeContext['setMcpActivityHooks']>[0],", "activity?: Parameters<PlatformRuntimeContext['setMcpActivityHooks']>[0],\n  assertCurrent?: () => Promise<void>,");
  replace('observer(context, connection) ?? Promise.resolve(undefined) },', 'observer(context, connection) ?? Promise.resolve(undefined) },\n    options.assertCurrent,');
  replace('const conn = await createMcpClientConnection(server.name, frozenSnapshot);', 'await assertCurrent?.();\n        const conn = await createMcpClientConnection(server.name, frozenSnapshot);');
  replace('const connectResult = await tryConnect(server.name, launchServer);', 'await assertCurrent?.();\n      const connectResult = await tryConnect(server.name, launchServer);');
  replace('const sandboxPolicy = createSandboxPolicy({', 'const sandboxPolicy = createSandboxPolicy({pathDenylist:options.privateStateRoots,');
  replace("const stateRootDir = join(options.cwd, '.xiaok', 'state');","const stateRootDir = options.stateRootDir ?? join(options.cwd, '.xiaok', 'state');");
  replace("const teamService = createTeamService({ store: new FileTeamStore(join(stateRootDir, 'teams.json')) });","const teamService = options.teamService ?? createTeamService({ store: new FileTeamStore(join(stateRootDir, 'teams.json')) });");
  replace('dispose: () => { cuaManager.dispose(); }', 'dispose: () => cuaManager.dispose()');
  const start=text.indexOf('      for (const disposable of disposables.splice(0).reverse()) {');
  const end=text.indexOf('      if (shutdownErrors.length)',start);
  if(start<0||end<0)throw Error('xiaok_context_cleanup_basis_changed');
  text=text.slice(0,start)+`      const resourceShutdowns = await Promise.allSettled(disposables.splice(0).reverse().map(disposable => Promise.resolve().then(() => typeof disposable.close === 'function' ? disposable.close() : disposable.dispose())));
      const shutdownErrors = [...backgroundShutdowns,...resourceShutdowns].filter(result => result.status === 'rejected').map(result => result.reason);
`+text.slice(end);

 }
 if(path.endsWith('/runtime/registry-factory.ts')){
  replace('.filter((tool) => !isCcRuntimeOnlyTool(tool));', '.filter((tool) => !isCcRuntimeOnlyTool(tool) && options.isToolEnabled?.(tool.definition.name) !== false);');
  replace('!state.baseNames.has(tool.definition.name)', 'options.isToolEnabled?.(tool.definition.name) !== false && !state.baseNames.has(tool.definition.name)');
  replace('...createTeamTools(options.platform.teamService),','...(options.teamTools ?? createTeamTools(options.platform.teamService)),');
  replace("const reminders = options.source === 'chat'","const reminders = !options.disableReminders && options.source === 'chat'");
  replace('const name = tool.definition.name;\n      const current', 'tool = options.bindTool?.(tool, state.cwd) ?? tool;\n      const name = tool.definition.name;\n      const current');
  // The child registry uses the same permission owner and revocation guards.
  replace('for (const tool of orderedTools) {','for (let tool of orderedTools) {');
  replace('const hooksRunner = createHooksRunner({', 'const hooksRunner = createHooksRunner({assertCurrent:options.assertCurrent,promptExecutor:options.promptExecutor,');
  replace('createRegistry: createRegistryForCwd,\n    getReminderApi()', 'createRegistry: createRegistryForCwd,\n    listChildren: () => multiAgentCoordinator?.listAgents({requestSource:\'agent\',callerId:\'main\'}) ?? [],\n    getReminderApi()');
  replace('const registry = new ToolRegistry({', 'const boundTools = filteredTools.map(tool => options.bindTool?.(tool, cwd) ?? tool);\n    const boundDescriptions = new Map(); filteredTools.forEach((tool, index) => { const metadata = wrappedDescriptions.get(tool); if(metadata)boundDescriptions.set(boundTools[index],metadata); });\n    const registry = new ToolRegistry({');
  replace('permissionManager: options.permissionManager,', 'permissionManager: options.permissionManagerForCwd?.(cwd) ?? options.permissionManager,');
  replace('onPrompt: options.onPrompt,', 'onPrompt: options.onPromptForCwd ? (name, args, meta) => options.onPromptForCwd(cwd, name, args, meta) : options.onPrompt,');
  replace('}, filteredTools,wrappedDescriptions);','}, boundTools,boundDescriptions);');
  replace('installed: new Map(filteredTools.filter((tool) => platformMcpInstances.has(tool)).map((tool) => [tool.definition.name, tool])),','cwd, installed: new Map(filteredTools.flatMap((tool,index) => platformMcpInstances.has(tool) ? [[boundTools[index].definition.name, boundTools[index]]] : [])),');
 }
 if(path.endsWith('/mcp/transport.ts')){
  // waitForProcessExit is awaited by every MCP close; an unref'd poll lets Node drain the loop and abandon the close once the child's own handles are gone.
  const poll='      const timer = setTimeout(resolve, PROCESS_EXIT_POLL_MS);\n      timer.unref?.();';
  replace(poll,'      setTimeout(resolve, PROCESS_EXIT_POLL_MS);');replace(poll,'      setTimeout(resolve, PROCESS_EXIT_POLL_MS);');
 }
 return text;
}
export const xiaokPlatformAdaptation={name:'kteam-xiaok-platform-seams',setup(build){build.onLoad({filter:/\/vendor\/xiaok-runtime\/.*\.ts$/},args=>({contents:adaptPlatformSource(args.path,readFileSync(args.path,'utf8')),loader:'ts'}));}};
