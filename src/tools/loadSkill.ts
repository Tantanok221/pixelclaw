import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { loadSkillByName } from "../skills/index.js";

const loadSkillSchema = Type.Object({
  name: Type.String({ description: "Skill name to load" }),
});

type LoadSkillInput = Static<typeof loadSkillSchema>;

export function createLoadSkillTool(cwd: string): AgentTool<typeof loadSkillSchema> {
  return {
    name: "load_skill",
    label: "load_skill",
    description: "Load the full content of a named skill discovered by list_skill.",
    parameters: loadSkillSchema,
    execute: async (_toolCallId, { name }: LoadSkillInput) => {
      const skill = await loadSkillByName(name, cwd);
      const description = skill.description || "(no description)";
      const text = [
        `name: ${skill.name}`,
        `description: ${description}`,
        `scope: ${skill.scope}`,
        `path: ${skill.path}`,
        "",
        skill.content,
      ].join("\n");

      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}
