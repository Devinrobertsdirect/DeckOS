import OpenAI from "openai";

function makeClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "missing-key",
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  });
}

// Proxy reads process.env fresh on every call so keys set via Settings take effect immediately
export const openai = new Proxy({} as OpenAI, {
  get(_: OpenAI, prop: string | symbol) {
    return (makeClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
