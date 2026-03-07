import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";

const exec = promisify(execCallback);

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
});

export type BashToolInput = Static<typeof bashSchema>;

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "bash",
    description: "Execute a shell command in the configured working directory.",
    parameters: bashSchema,
    execute: async (_toolCallId, { command, timeout }: BashToolInput, signal?: AbortSignal) => {
      try {
        const result = await exec(command, {
          cwd,
          signal,
          timeout: timeout && timeout > 0 ? timeout * 1000 : undefined,
          maxBuffer: 10 * 1024 * 1024,
          shell:
            process.platform === "win32"
              ? (process.env.ComSpec ?? "cmd.exe")
              : (process.env.SHELL ?? "/bin/bash"),
        });
        const output =
          [result.stdout, result.stderr].filter(Boolean).join("").trim() || "(no output)";
        return { content: [{ type: "text", text: output }], details: undefined };
      } catch (error: any) {
        const output = [error.stdout, error.stderr, error.message]
          .filter(Boolean)
          .join("\n")
          .trim();
        throw new Error(output || "Command execution failed.");
      }
    },
  };
}
