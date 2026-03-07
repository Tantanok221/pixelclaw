import { promises as fs } from "node:fs";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { resolveFromCwd } from "./shared.js";

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace" }),
  newText: Type.String({ description: "New text to replace oldText with" }),
});

export type EditToolInput = Static<typeof editSchema>;

export function createEditTool(cwd: string): AgentTool<typeof editSchema> {
  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by replacing one unique exact text match.",
    parameters: editSchema,
    execute: async (_toolCallId, { path: inputPath, oldText, newText }: EditToolInput) => {
      const absolutePath = resolveFromCwd(inputPath, cwd);
      const content = await fs.readFile(absolutePath, "utf-8");
      const occurrences = content.split(oldText).length - 1;

      if (occurrences === 0) {
        throw new Error("oldText was not found in the target file.");
      }
      if (occurrences > 1) {
        throw new Error("oldText matched multiple times. Provide a more specific oldText.");
      }

      const updated = content.replace(oldText, newText);
      await fs.writeFile(absolutePath, updated, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully updated ${inputPath}` }],
        details: undefined,
      };
    },
  };
}
