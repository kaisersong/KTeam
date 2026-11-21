export interface PluginCommand {
  id: string;
  title: string;
  draft: string;
}

export interface PluginManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  contributes: {commands: PluginCommand[]};
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  revision: number;
  digest: string;
}

export interface PluginRegistryView {
  ok: true;
  revision: number;
  plugins: InstalledPlugin[];
}

export interface PluginPreview {
  ok: true;
  revision: number;
  manifest: PluginManifest;
  digest: string;
}

export interface PluginCommandChoice {
  pluginId: string;
  pluginName: string;
  commandId: string;
  title: string;
  revision: number;
}

export const isPluginCommand = (value: string) => /^\/plugin(?:\s|$)/i.test(value.trim());
