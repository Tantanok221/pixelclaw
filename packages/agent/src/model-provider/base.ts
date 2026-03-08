import {
  getModel,
  type AssistantMessage,
  type KnownProvider,
  type Model,
} from "@mariozechner/pi-ai";
import { createEmptyUsage } from "./shared.js";

export abstract class BaseModelProvider {
  abstract readonly providerName: KnownProvider;
  abstract readonly modelName: string;
  abstract readonly apiName: string;

  getModel(): Model<any> {
    return getModel(this.providerName, this.modelName as never);
  }

  async getApiKey(_startDir = process.cwd()): Promise<string | undefined> {
    return undefined;
  }

  createAssistantMessage(content: string, timestamp: number): AssistantMessage {
    return {
      role: "assistant",
      content: [{ type: "text", text: content }],
      api: this.apiName,
      provider: this.providerName,
      model: this.modelName,
      usage: createEmptyUsage(),
      stopReason: "stop",
      timestamp,
    };
  }
}
