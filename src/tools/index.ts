import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createListSkillTool } from "./listSkill.js";
import { createLsTool } from "./ls.js";
import { createLoadSkillTool } from "./loadSkill.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createAgentTools(cwd: string): AgentTool<any>[] {
  return [
    createListSkillTool(cwd),
    createLoadSkillTool(cwd),
    createReadTool(cwd),
    createBashTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
