import { createInterface } from "node:readline";
import { access, readFile, writeFile } from "node:fs/promises";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import { resolveAuthFilePath } from "../../agent/src/ModelProvider.js";

const PROVIDER_NAME = "openai-codex";

interface RunAgentAuthCliOptions {
  startDir?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function runAgentAuthCli(
  _args: string[],
  options: RunAgentAuthCliOptions = {},
) {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const rl = createInterface({
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout,
  });

  try {
    const credentials = await loginOpenAICodex({
      onAuth: ({ url, instructions }) => {
        stdout(`Open this URL in your browser:\n${url}`);
        if (instructions) {
          stdout(instructions);
        }
      },
      onPrompt: async ({ message, placeholder }) => {
        const prompt = `${message}${placeholder ? ` (${placeholder})` : ""} `;
        return await new Promise<string>((resolve) => rl.question(prompt, resolve));
      },
      onProgress: stdout,
    });

    const authFilePath = await resolveAuthFilePath(options.startDir ?? process.cwd());
    const auth = await loadAuth(authFilePath);
    auth[PROVIDER_NAME] = {
      type: "oauth",
      ...credentials,
    };

    await writeFile(authFilePath, JSON.stringify(auth, null, 2), "utf-8");
    stdout(`Credentials saved to ${authFilePath}`);

    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    rl.close();
  }
}

async function loadAuth(authFilePath: string) {
  if (!(await pathExists(authFilePath))) {
    return {} as Record<string, Record<string, unknown>>;
  }

  return JSON.parse(await readFile(authFilePath, "utf-8")) as Record<
    string,
    Record<string, unknown>
  >;
}

async function pathExists(candidatePath: string) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentAuthCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
