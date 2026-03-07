import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import {
  DEFAULT_GREP_LIMIT,
  isLikelyBinary,
  matchesGlob,
  resolveFromCwd,
  toPosixPath,
  walkRelativeEntries,
} from "./shared.js";

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal)" }),
  path: Type.Optional(
    Type.String({ description: "Directory/file to search (default: current directory)" }),
  ),
  glob: Type.Optional(Type.String({ description: "Optional file glob filter, e.g. '*.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string" })),
  context: Type.Optional(Type.Number({ description: "Lines of context before/after matches" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches" })),
});

export type GrepToolInput = Static<typeof grepSchema>;

export function createGrepTool(cwd: string): AgentTool<typeof grepSchema> {
  return {
    name: "grep",
    label: "grep",
    description: "Search file contents for a pattern.",
    parameters: grepSchema,
    execute: async (
      _toolCallId,
      { pattern, path: inputPath, glob, ignoreCase, literal, context, limit }: GrepToolInput,
    ) => {
      const searchTarget = resolveFromCwd(inputPath ?? ".", cwd);
      const stats = await fs.stat(searchTarget);
      const maxMatches = Math.max(1, limit ?? DEFAULT_GREP_LIMIT);
      const contextLines = Math.max(0, context ?? 0);

      const candidateFiles = stats.isDirectory()
        ? (await walkRelativeEntries(searchTarget)).files
        : [path.basename(searchTarget)];
      const baseDir = stats.isDirectory() ? searchTarget : path.dirname(searchTarget);
      const filteredFiles = glob
        ? candidateFiles.filter((file) => matchesGlob(glob, file))
        : candidateFiles;

      const matcher = literal
        ? (line: string) => {
            const needle = ignoreCase ? pattern.toLowerCase() : pattern;
            const haystack = ignoreCase ? line.toLowerCase() : line;
            return haystack.includes(needle);
          }
        : (() => {
            const regex = new RegExp(pattern, ignoreCase ? "i" : "");
            return (line: string) => regex.test(line);
          })();

      const outputBlocks: string[] = [];
      let matchCount = 0;

      for (const relativeFile of filteredFiles) {
        if (matchCount >= maxMatches) {
          break;
        }

        const absoluteFile = stats.isDirectory() ? path.join(baseDir, relativeFile) : searchTarget;
        let fileContent: string;
        try {
          fileContent = await fs.readFile(absoluteFile, "utf-8");
        } catch {
          continue;
        }
        if (isLikelyBinary(fileContent)) {
          continue;
        }

        const lines = fileContent.split("\n");
        for (let index = 0; index < lines.length; index++) {
          if (!matcher(lines[index])) {
            continue;
          }

          matchCount++;
          const start = Math.max(0, index - contextLines);
          const end = Math.min(lines.length - 1, index + contextLines);
          for (let lineIndex = start; lineIndex <= end; lineIndex++) {
            if (lineIndex === index) {
              outputBlocks.push(
                `${toPosixPath(relativeFile)}:${lineIndex + 1}: ${lines[lineIndex]}`,
              );
            } else {
              outputBlocks.push(
                `${toPosixPath(relativeFile)}-${lineIndex + 1}- ${lines[lineIndex]}`,
              );
            }
          }

          if (matchCount >= maxMatches) {
            break;
          }
        }
      }

      if (outputBlocks.length === 0) {
        return { content: [{ type: "text", text: "No matches found" }], details: undefined };
      }

      const limitNotice =
        matchCount >= maxMatches
          ? `\n\n[${maxMatches} matches shown, refine pattern or increase limit]`
          : "";
      return {
        content: [{ type: "text", text: `${outputBlocks.join("\n")}${limitNotice}` }],
        details: undefined,
      };
    },
  };
}
