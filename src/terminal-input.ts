import * as path from "node:path";

export function composerSubmitChunks(command: string, text: string) {
  const normalized = normalizeSubmittedText(text);
  if (usesLfSubmit(command) && normalized) {
    return [normalized, "\r"];
  }
  if (usesLfCrSubmit(command) && normalized) {
    return [normalized, "\n", "\r"];
  }
  return [`${normalized.replaceAll("\n", "\r")}\r`];
}

export function usesLfCrSubmit(command: string) {
  return path.basename(command).toLowerCase() === "codex";
}

function usesLfSubmit(command: string) {
  const name = path.basename(command).toLowerCase();
  return name === "opencode" || name === "pi";
}

function normalizeSubmittedText(text: string) {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n$/g, "");
}
