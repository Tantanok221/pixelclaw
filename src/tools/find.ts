import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { DEFAULT_FIND_LIMIT, matchesGlob, resolveFromCwd, walkRelativeEntries } from "./shared.js";

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern, e.g. '*.ts' or '**/*.json'" }),
  path: Type.Optional(
    Type.String({ description: "Directory to search (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results to return" })),
});

export type FindToolInput = Static<typeof findSchema>;

export function createFindTool(cwd: string): AgentTool<typeof findSchema> {
  return {
    name: "find",
    label: "find",
    description: "Find files/directories by glob-like pattern.",
    parameters: findSchema,
    execute: async (_toolCallId, { pattern, path: inputPath, limit }: FindToolInput) => {
      const target = resolveFromCwd(inputPath ?? ".", cwd);
      const targetStat = await fs.stat(target);
      const maxResults = Math.max(1, limit ?? DEFAULT_FIND_LIMIT);

      let results: string[] = [];
      if (targetStat.isDirectory()) {
        const { all } = await walkRelativeEntries(target);
        results = all.filter((entry) => matchesGlob(pattern, entry));
      } else {
        const fileName = path.basename(target);
        if (matchesGlob(pattern, fileName)) {
          results = [fileName];
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No files found matching pattern" }],
          details: undefined,
        };
      }

      const selected = results.slice(0, maxResults);
      const notice =
        results.length > maxResults
          ? `\n\n[${maxResults} results shown, refine pattern or increase limit]`
          : "";
      return {
        content: [{ type: "text", text: `${selected.join("\n")}${notice}` }],
        details: undefined,
      };
    },
  };
}
