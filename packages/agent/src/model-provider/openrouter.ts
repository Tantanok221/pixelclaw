import { BaseModelProvider } from "./base.js";

export class OpenRouterModelProvider extends BaseModelProvider {
  readonly providerName = "openrouter";
  readonly apiName = "openai-completions";

  constructor(readonly modelName: string) {
    super();
  }

  async getApiKey(_startDir = process.cwd()) {
    return process.env.OPENROUTER_API_KEY;
  }
}

export const paraphraseModelProvider = new OpenRouterModelProvider("x-ai/grok-4.1-fast");
