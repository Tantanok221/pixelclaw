import { promises as fs } from "node:fs";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { DEFAULT_READ_LIMIT, resolveFromCwd } from "./shared.js";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
  return {
    name: "read",
    label: "read",
    description: "Read a text file with optional offset/limit for large files.",
    parameters: readSchema,
    execute: async (_toolCallId, { path: inputPath, offset, limit }: ReadToolInput) => {
      const absolutePath = resolveFromCwd(inputPath, cwd);
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const startIndex = Math.max(0, (offset ?? 1) - 1);
      const readLimit = Math.max(1, limit ?? DEFAULT_READ_LIMIT);
      const endIndex = Math.min(lines.length, startIndex + readLimit);

      if (startIndex >= lines.length) {
        throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total).`);
      }

      const chunk = lines.slice(startIndex, endIndex).join("\n");
      const hasMore = endIndex < lines.length;
      const nextOffset = endIndex + 1;
      const output = hasMore
        ? `${chunk}\n\n[More lines available. Continue with offset=${nextOffset}.]`
        : chunk;

      return { content: [{ type: "text", text: output }], details: undefined };
    },
  };
}
