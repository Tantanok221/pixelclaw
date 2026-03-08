import path from "node:path";
import { ensureAgentSystemRoot } from "../workspaceRoot.js";

export async function resolveProviderAuthFilePath(_startDir = process.cwd()) {
  const agentSystemRoot = await ensureAgentSystemRoot();
  return path.join(agentSystemRoot, "auth.json");
}
