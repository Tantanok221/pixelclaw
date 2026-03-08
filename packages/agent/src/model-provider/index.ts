export { BaseModelProvider } from "./base.js";
export { CodexModelProvider, codexModelProvider } from "./codex.js";

import { codexModelProvider } from "./codex.js";

export const defaultModelProvider = codexModelProvider;

export function getConfiguredModel() {
  return defaultModelProvider.getModel();
}

export async function getProviderApiKey(startDir = process.cwd()) {
  return defaultModelProvider.getApiKey(startDir);
}

export async function resolveAuthFilePath(startDir = process.cwd()) {
  return codexModelProvider.resolveAuthFilePath(startDir);
}
