// The AI behind extensions' ai.ask. Prompts go through the Study folder service (memory-engine
// serve), never straight from an extension: to Ollama when the AI runs on this computer
// (POST /local/ask), otherwise to Open Notebook through its bridge (POST /notebook/ask). The host has already checked the extension's permission; this adds
// the size and rate limits and turns failures into the codes extensions see.

import { HostError } from "../extensions/host.js";
import { VaultOffline } from "../data/vaultClient";
import { LOCAL_MESSAGES } from "./localAi";

export const PROMPT_LIMIT = 50 * 1024; // bytes of UTF-8
export const RATE_LIMIT = 20; // asks per extension
export const RATE_WINDOW = 60_000; // in a rolling minute

const MESSAGES = {
  "ai-unavailable": "Start Kratt's engine to use AI",
  "ai-auth": "Kratt's engine didn't accept the password. Check it in Settings > AI",
};

// address() returns the Open Notebook address from settings and local() whether the AI runs on
// this computer, both read at each ask.
export function createAiService({ client, address, local = () => false, now = Date.now }) {
  const recent = new Map(); // extension id -> times of accepted asks in the last minute

  return {
    async ask(extensionId, prompt) {
      if (new TextEncoder().encode(prompt).length > PROMPT_LIMIT) {
        throw new HostError("limit", "The prompt is too long (50 KB at most)");
      }
      const time = now();
      const times = (recent.get(extensionId) ?? []).filter((t) => time - t < RATE_WINDOW);
      if (times.length >= RATE_LIMIT) {
        recent.set(extensionId, times);
        throw new HostError("limit", "Too many AI requests. Wait a minute and try again");
      }
      recent.set(extensionId, [...times, time]);
      const onComputer = local();
      try {
        const { output } = onComputer ? await client.localAsk(prompt) : await client.notebookAsk(address(), prompt);
        return output;
      } catch (error) {
        if (error instanceof VaultOffline) throw new HostError("ai-unavailable", "The Study folder service isn't running");
        if (onComputer) throw new HostError("ai-unavailable", LOCAL_MESSAGES[error?.message] ?? LOCAL_MESSAGES["ollama-unavailable"]);
        throw new HostError("ai-unavailable", MESSAGES[error?.message] ?? error?.message ?? MESSAGES["ai-unavailable"]);
      }
    },
  };
}
