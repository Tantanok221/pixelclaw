import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { discoverSkills } from "../skills/index.js";

const listSkillSchema = Type.Object({});

export function createListSkillTool(cwd: string): AgentTool<typeof listSkillSchema> {
  return {
    name: "list_skill",
    label: "list_skill",
    description: "List available skills from global and project-local skill directories.",
    parameters: listSkillSchema,
    execute: async () => {
      const skills = await discoverSkills(cwd);

      if (skills.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No skills found in ~/.agents/skills or ./.agents/skills.",
            },
          ],
          details: undefined,
        };
      }

      const text = skills
        .map((skill) => {
          const description = skill.description ? ` - ${skill.description}` : "";
          return `${skill.name} [${skill.scope}]${description}\npath: ${skill.path}`;
        })
        .join("\n\n");

      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}
