import { getModel } from "@mariozechner/pi-ai";
import { readFileSync, writeFileSync } from "node:fs";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";

const AUTH_FILE_PATH = "auth.json";
const PROVIDER_NAME = "openai-codex";
const MODEL_NAME = "gpt-5.4";

export function getConfiguredModel() {
  return getModel(PROVIDER_NAME, MODEL_NAME);
}

export async function getProviderApiKey() {
  const auth = JSON.parse(readFileSync(AUTH_FILE_PATH, "utf-8"));
  const result = await getOAuthApiKey(PROVIDER_NAME, auth);

  if (!result) {
    throw new Error("Not logged in");
  }

  auth[PROVIDER_NAME] = { type: "oauth", ...result.newCredentials };
  writeFileSync(AUTH_FILE_PATH, JSON.stringify(auth, null, 2));

  return result.apiKey;
}
