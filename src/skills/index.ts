import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SkillScope = "global" | "local";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
}

export interface LoadedSkill extends SkillSummary {
  content: string;
}

export interface SkillDiscoveryOptions {
  globalRoot?: string;
  localRoot?: string;
}

interface ParsedSkillFile {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  content: string;
}

interface FrontmatterResult {
  attributes: Record<string, string>;
  body: string;
}

export async function discoverSkills(
  cwd: string,
  options: SkillDiscoveryOptions = {},
): Promise<SkillSummary[]> {
  const registry = await buildSkillRegistry(cwd, options);

  return Array.from(registry.values())
    .map(({ content: _content, ...summary }) => summary)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadSkillByName(
  name: string,
  cwd: string,
  options: SkillDiscoveryOptions = {},
): Promise<LoadedSkill> {
  const registry = await buildSkillRegistry(cwd, options);
  const match = registry.get(normalizeSkillName(name));

  if (!match) {
    throw new Error(`Skill not found: ${name}`);
  }

  return match;
}

async function buildSkillRegistry(
  cwd: string,
  options: SkillDiscoveryOptions,
): Promise<Map<string, ParsedSkillFile>> {
  const roots = resolveSkillRoots(cwd, options);
  const registry = new Map<string, ParsedSkillFile>();

  for (const skill of await scanSkillRoot(roots.globalRoot, "global")) {
    registry.set(normalizeSkillName(skill.name), skill);
  }

  for (const skill of await scanSkillRoot(roots.localRoot, "local")) {
    registry.set(normalizeSkillName(skill.name), skill);
  }

  return registry;
}

function resolveSkillRoots(cwd: string, options: SkillDiscoveryOptions) {
  return {
    globalRoot: options.globalRoot ?? path.join(os.homedir(), ".agent", "skills"),
    localRoot: options.localRoot ?? path.join(cwd, ".agent", "skills"),
  };
}

async function scanSkillRoot(root: string, scope: SkillScope): Promise<ParsedSkillFile[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const files = await collectSkillFiles(root);
  const skills = await Promise.all(files.map((filePath) => readSkillFile(root, filePath, scope)));
  return skills.filter((skill): skill is ParsedSkillFile => skill !== null);
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, absolutePath);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const isSkillFile = entry.name === "SKILL.md";
      const isDirectMarkdown =
        path.dirname(relativePath) === "." && entry.name.toLowerCase().endsWith(".md");

      if (isSkillFile || isDirectMarkdown) {
        results.push(absolutePath);
      }
    }
  }

  await visit(root);
  return results.sort((left, right) => left.localeCompare(right));
}

async function readSkillFile(
  root: string,
  filePath: string,
  scope: SkillScope,
): Promise<ParsedSkillFile | null> {
  const rawContent = await fs.readFile(filePath, "utf-8");
  const { attributes, body } = parseFrontmatter(rawContent);
  const name = deriveSkillName(filePath, attributes.name);

  if (!name) {
    return null;
  }

  return {
    name,
    description: attributes.description ?? "",
    path: filePath,
    scope,
    content: body,
  };
}

function deriveSkillName(filePath: string, explicitName?: string): string {
  if (explicitName?.trim()) {
    return explicitName.trim();
  }

  if (path.basename(filePath) === "SKILL.md") {
    return path.basename(path.dirname(filePath));
  }

  return path.basename(filePath, path.extname(filePath));
}

function parseFrontmatter(content: string): FrontmatterResult {
  const lines = content.split(/\r?\n/);

  if (lines[0] !== "---") {
    return { attributes: {}, body: content.trim() };
  }

  const attributes: Record<string, string> = {};
  let index = 1;

  for (; index < lines.length; index++) {
    const line = lines[index];

    if (line === "---") {
      index += 1;
      break;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    attributes[key] = stripWrappingQuotes(value);
  }

  return {
    attributes,
    body: lines.slice(index).join("\n").trim(),
  };
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
