import { promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_READ_LIMIT = 2000;
export const DEFAULT_LS_LIMIT = 500;
export const DEFAULT_FIND_LIMIT = 1000;
export const DEFAULT_GREP_LIMIT = 100;

export function resolveFromCwd(inputPath: string, cwd: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(cwd, inputPath);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(globPattern: string): RegExp {
  const normalized = toPosixPath(globPattern.trim());
  const escaped = escapeRegExp(normalized);
  const withDoubleStar = escaped.replace(/\\\*\\\*/g, ".*");
  const withSingleStar = withDoubleStar.replace(/\\\*/g, "[^/]*");
  const withQuestion = withSingleStar.replace(/\\\?/g, ".");
  return new RegExp(`^${withQuestion}$`);
}

export function matchesGlob(pattern: string, relativePath: string): boolean {
  const normalizedRelative = toPosixPath(relativePath).replace(/\/$/, "");
  const normalizedPattern = toPosixPath(pattern);
  const regex = globToRegExp(normalizedPattern);
  if (normalizedPattern.includes("/")) {
    return regex.test(normalizedRelative);
  }
  return regex.test(path.posix.basename(normalizedRelative));
}

export async function walkRelativeEntries(
  baseDir: string,
): Promise<{ files: string[]; all: string[] }> {
  const files: string[] = [];
  const all: string[] = [];

  async function walk(currentRelative: string): Promise<void> {
    const absolute = currentRelative ? path.join(baseDir, currentRelative) : baseDir;
    const entries = await fs.readdir(absolute, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const relative = currentRelative
        ? toPosixPath(path.join(currentRelative, entry.name))
        : toPosixPath(entry.name);

      if (entry.isDirectory()) {
        all.push(`${relative}/`);
        await walk(relative);
        continue;
      }

      if (entry.isFile()) {
        all.push(relative);
        files.push(relative);
      }
    }
  }

  await walk("");
  return { files, all };
}

export function isLikelyBinary(content: string): boolean {
  return content.includes("\u0000");
}
