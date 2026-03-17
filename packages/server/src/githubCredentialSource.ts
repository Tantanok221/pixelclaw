import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GithubCredentialAccount {
  hostname: string;
  login: string;
  scopes: string[];
  tokenSource: string;
}

export interface GithubCredentialSource {
  listAccounts(): Promise<GithubCredentialAccount[]>;
  getAccessToken(input: { hostname: string; login: string }): Promise<string>;
}

export function createGithubCredentialSource(): GithubCredentialSource {
  return {
    async listAccounts() {
      const payload = await runGhJsonCommand<{ hosts?: Record<string, Array<GhHostAccount>> }>([
        "auth",
        "status",
        "--json",
        "hosts",
      ]);

      const hosts = payload.hosts ?? {};
      return Object.values(hosts)
        .flat()
        .filter((account) => account.state === "success")
        .map((account) => ({
          hostname: account.host,
          login: account.login,
          scopes: splitScopes(account.scopes),
          tokenSource: account.tokenSource ?? "unknown",
        }));
    },

    async getAccessToken(input) {
      const { stdout } = await runGhCommand([
        "auth",
        "token",
        "--hostname",
        input.hostname,
        "--user",
        input.login,
      ]);
      const token = stdout.trim();
      if (!token) {
        throw new Error(`GitHub CLI did not return a token for ${input.login}@${input.hostname}`);
      }

      return token;
    },
  };
}

interface GhHostAccount {
  host: string;
  login: string;
  scopes?: string;
  state?: string;
  tokenSource?: string;
}

async function runGhJsonCommand<T>(args: string[]) {
  const { stdout } = await runGhCommand(args);

  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(`Failed to parse GitHub CLI output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runGhCommand(args: string[]) {
  try {
    return await execFileAsync("gh", args, {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";

    if (code === "ENOENT") {
      throw new Error("GitHub CLI is not installed. Install `gh` and run `gh auth login` first.");
    }

    throw new Error(stderr || "GitHub CLI command failed");
  }
}

function splitScopes(rawScopes: string | undefined) {
  if (!rawScopes) {
    return [];
  }

  return rawScopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}
