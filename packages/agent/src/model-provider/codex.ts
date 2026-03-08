import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import { readFileSync, writeFileSync } from "node:fs";
import { BaseModelProvider } from "./base.js";
import { resolveProviderAuthFilePath } from "./auth.js";

export class CodexModelProvider extends BaseModelProvider {
  readonly providerName = "openai-codex";
  readonly modelName = "gpt-5.4";
  readonly apiName = "openai-codex-responses";

  async getApiKey(startDir = process.cwd()) {
    const authFilePath = await this.resolveAuthFilePath(startDir);
    const auth = JSON.parse(readFileSync(authFilePath, "utf-8"));
    const result = await getOAuthApiKey(this.providerName, auth);

    if (!result) {
      throw new Error("Not logged in");
    }

    auth[this.providerName] = { type: "oauth", ...result.newCredentials };
    writeFileSync(authFilePath, JSON.stringify(auth, null, 2));

    return result.apiKey;
  }

  async resolveAuthFilePath(startDir = process.cwd()) {
    return resolveProviderAuthFilePath(startDir);
  }
}

export const codexModelProvider = new CodexModelProvider();
