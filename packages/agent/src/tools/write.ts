import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { resolveFromCwd } from "./shared.js";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema> {
  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates parent directories automatically.",
    parameters: writeSchema,
    execute: async (_toolCallId, { path: inputPath, content }: WriteToolInput) => {
      const absolutePath = resolveFromCwd(inputPath, cwd);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf-8");
      return {
        content: [
          { type: "text", text: `Successfully wrote ${content.length} bytes to ${inputPath}` },
        ],
        details: undefined,
      };
    },
  };
}
