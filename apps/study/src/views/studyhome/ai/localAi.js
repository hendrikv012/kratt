// The AI on this computer: Ollama, reached through the Study folder service (memory-engine serve),
// which starts Ollama when it isn't running. These are its error codes as people read them.

export const LOCAL_MESSAGES = {
  "ollama-missing": "Ollama isn't installed, so Kratt can't answer on this computer. Install it from ollama.com, or pick Online service in Settings > AI.",
  "ollama-failed": "Ollama didn't start. Settings > AI shows why.",
  "no-model": "Pick a model in Settings > AI first.",
  "model-missing": "The model picked in Settings > AI isn't installed in Ollama any more. Pick another one there.",
  "ollama-unavailable": "Ollama stopped answering. Try again in a moment.",
};

export const isLocalError = (code) => Object.hasOwn(LOCAL_MESSAGES, code);
