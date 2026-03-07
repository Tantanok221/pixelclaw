import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../src/tools/index.js";
import { discoverSkills, loadSkillByName } from "../src/skills/index.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeSkill(root: string, name: string, content: string) {
  const skillDir = path.join(root, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(dir, { recursive: true, force: true }),
      );
    }),
  );
});

describe("skill discovery", () => {
  it("prefers project-local skills over global ones", async () => {
    const homeDir = await createTempDir("pixelbot-home-");
    const projectDir = await createTempDir("pixelbot-project-");
    const globalRoot = path.join(homeDir, ".agent", "skills");
    const localRoot = path.join(projectDir, ".agent", "skills");

    await writeSkill(
      globalRoot,
      "debugging",
      `---
name: debugging
description: Global debugging workflow
---
global body`,
    );

    await writeSkill(
      localRoot,
      "debugging",
      `---
name: debugging
description: Local debugging workflow
---
local body`,
    );

    await writeSkill(
      localRoot,
      "planning",
      `---
name: planning
description: Planning workflow
---
plan body`,
    );

    const skills = await discoverSkills(projectDir, { globalRoot, localRoot });

    expect(skills).toHaveLength(2);
    expect(skills.map((skill) => skill.name)).toEqual(["debugging", "planning"]);
    expect(skills[0]).toMatchObject({
      name: "debugging",
      description: "Local debugging workflow",
      scope: "local",
    });

    const loaded = await loadSkillByName("debugging", projectDir, { globalRoot, localRoot });

    expect(loaded).toMatchObject({
      name: "debugging",
      description: "Local debugging workflow",
      scope: "local",
    });
    expect(loaded.content).toBe("local body");
  });

  it("registers list_skill and load_skill tools", () => {
    const tools = createAgentTools("/tmp/project");

    expect(tools.map((tool) => tool.name)).toContain("list_skill");
    expect(tools.map((tool) => tool.name)).toContain("load_skill");
  });
});
