import * as path from "node:path";

export type SessionSdkPayload = {
  provider: "" | "opencode" | "codex";
  state: "unavailable" | "ready" | "connected" | "not-found" | "error";
  baseUrl: string;
  externalSessionId: string;
  status: string;
  updatedAt: string;
  error: string;
  sidecarSummary: SidecarSummaryState;
  forks: SidecarSummaryFork[];
  summary: AgentSessionSummary | null;
};

export type SidecarSummaryState = {
  implemented: boolean;
  status: "idle" | "running" | "completed" | "error";
  method: "" | "opencode.session.fork+summarize" | "codex.startThread+summary";
  sourceSessionId: string;
  forkSessionId: string;
  updatedAt: string;
  result: boolean | null;
  error: string;
  note: string;
};

export type SidecarSummaryFork = {
  provider: "opencode" | "codex";
  purpose: "sidecarSummary";
  sourceSessionId: string;
  forkSessionId: string;
  createdAt: string;
  updatedAt: string;
  status: "created" | "summarized" | "error";
  result: boolean | null;
  error: string;
  summary: AgentSessionSummary | null;
};

export type AgentSessionSummary = {
  provider: "opencode" | "codex";
  title: string;
  messageCount: number;
  diffCount: number;
  additions: number;
  deletions: number;
  latestUserText: string;
  latestAssistantText: string;
  transcript: Array<{
    id: string;
    role: string;
    createdAt: string;
    text: string;
  }>;
  diffs: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
};

type ResolveOpenCodeSessionInput = {
  sessions: any[];
  cwd: string;
  tuiCreatedAt: string;
  currentExternalSessionId: string;
  args: string[];
};

export function resolveOpenCodeSession(input: ResolveOpenCodeSessionInput) {
  const explicitSessionId = getExplicitOpenCodeSessionId(input.args);
  if (explicitSessionId) {
    return input.sessions.find((candidate) => candidate.id === explicitSessionId) || null;
  }

  const matchingDirectory = input.sessions.filter((candidate) => samePath(candidate.directory, input.cwd));
  const candidates = matchingDirectory.length ? matchingDirectory : input.sessions;
  const tuiStartedAt = new Date(input.tuiCreatedAt).getTime();
  const createdAfterLaunch = candidates.filter((candidate) => Number(candidate.time?.created || 0) >= tuiStartedAt - 10_000);

  if (input.currentExternalSessionId) {
    const existing = createdAfterLaunch.find((candidate) => candidate.id === input.currentExternalSessionId);
    if (existing) {
      return existing;
    }
  }

  const freshCandidates = createdAfterLaunch.length ? createdAfterLaunch : candidates;
  return freshCandidates
    .slice()
    .sort((left, right) => Number(right.time?.updated || right.time?.created || 0) - Number(left.time?.updated || left.time?.created || 0))[0] || null;
}

export function buildOpenCodeSummary(session: any, messages: any[], diffs: any[]): AgentSessionSummary {
  const transcript = messages.map((message) => {
    const info = message.info || {};
    const parts = Array.isArray(message.parts) ? message.parts : [];
    return {
      id: String(info.id || ""),
      role: String(info.role || ""),
      createdAt: info.time?.created ? new Date(Number(info.time.created)).toISOString() : "",
      text: parts.map(extractOpenCodePartText).filter(Boolean).join("\n").trim().slice(0, 20_000),
    };
  });
  const userMessages = transcript.filter((message) => message.role === "user" && message.text && message.text !== "[compaction]");
  const assistantMessages = transcript.filter((message) => message.role === "assistant" && message.text);
  const latestUserText = userMessages.at(-1)?.text || "";
  const latestAssistantText = assistantMessages.at(-1)?.text || "";
  const normalizedDiffs = diffs.map((diff) => ({
    file: String(diff.file || ""),
    additions: Number(diff.additions || 0),
    deletions: Number(diff.deletions || 0),
  }));

  return {
    provider: "opencode",
    title: String(session.title || "OpenCode session"),
    messageCount: messages.length,
    diffCount: normalizedDiffs.length,
    additions: normalizedDiffs.reduce((total, diff) => total + diff.additions, 0),
    deletions: normalizedDiffs.reduce((total, diff) => total + diff.deletions, 0),
    latestUserText,
    latestAssistantText,
    transcript,
    diffs: normalizedDiffs,
  };
}

export function pickOpenCodeModel(messages: any[]) {
  for (const message of [...messages].reverse()) {
    const info = message.info || {};
    if (info.model?.providerID && info.model?.modelID) {
      return {
        providerID: String(info.model.providerID),
        modelID: String(info.model.modelID),
      };
    }
    if (info.providerID && info.modelID) {
      return {
        providerID: String(info.providerID),
        modelID: String(info.modelID),
      };
    }
  }
  return null;
}

function extractOpenCodePartText(part: any) {
  if (!part || typeof part !== "object") {
    return "";
  }
  if (part.type === "text") {
    return String(part.text || "");
  }
  if (part.type === "tool") {
    return `[tool ${String(part.tool || part.callID || "")}]`;
  }
  if (part.type === "file") {
    return `[file ${String(part.url || part.filename || "")}]`;
  }
  if (part.type) {
    return `[${String(part.type)}]`;
  }
  return "";
}

function getExplicitOpenCodeSessionId(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] || "";
    if (arg === "--session" || arg === "-s") {
      return args[index + 1] || "";
    }
    if (arg.startsWith("--session=")) {
      return arg.slice("--session=".length);
    }
  }
  return "";
}

function samePath(left: unknown, right: string) {
  if (!left) {
    return false;
  }
  return path.resolve(String(left)) === path.resolve(right);
}
