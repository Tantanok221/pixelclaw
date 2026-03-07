import { promises as fs } from "node:fs";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { DEFAULT_LS_LIMIT, resolveFromCwd } from "./shared.js";

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Directory to list (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return" })),
});

export type LsToolInput = Static<typeof lsSchema>;

export function createLsTool(cwd: string): AgentTool<typeof lsSchema> {
  return {
    name: "ls",
    label: "ls",
    description: "List directory contents.",
    parameters: lsSchema,
    execute: async (_toolCallId, { path: inputPath, limit }: LsToolInput) => {
      const targetDir = resolveFromCwd(inputPath ?? ".", cwd);
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const maxEntries = Math.max(1, limit ?? DEFAULT_LS_LIMIT);
      const sorted = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort((a, b) => a.localeCompare(b));
      const selected = sorted.slice(0, maxEntries);
      const notice =
        sorted.length > maxEntries
          ? `\n\n[${maxEntries} entries shown, refine path or increase limit]`
          : "";
      const output = selected.length > 0 ? `${selected.join("\n")}${notice}` : "(empty directory)";
      return { content: [{ type: "text", text: output }], details: undefined };
    },
  };
}
