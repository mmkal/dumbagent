import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { recentSessionPreviewFromMessages, type AgentSessionSummary, type RecentAgentSession } from "./opencode-sdk.ts";
import { createStructuredSessionBriefPrompt, isStructuredSessionBriefPrompt, parseStructuredSessionBrief } from "./session-brief.ts";

export type PiSessionInfo = SessionInfo;

type ResolvePiSessionInput = {
  sessions: PiSessionInfo[];
  cwd: string;
  tuiCreatedAt: string;
  currentExternalSessionId: string;
  args: string[];
};

export function piSessionDirForEnv(env: NodeJS.ProcessEnv) {
  return String(env.PI_SESSION_DIR || path.join(piAgentDirForEnv(env), "sessions"));
}

export function piAgentDirForEnv(env: NodeJS.ProcessEnv) {
  return String(env.PI_AGENT_DIR || path.join(String(env.HOME || os.homedir()), ".pi", "agent"));
}

export async function readPiSessions(sessionDir: string) {
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Pi session directory not found at ${sessionDir}`);
  }
  const { SessionManager } = await loadPiSdk();
  return await SessionManager.listAll();
}

export async function readRecentPiSessions(sessionDir: string, nowMs: number): Promise<RecentAgentSession[]> {
  const sessions = await readPiSessions(sessionDir);
  return recentPiSessionsFromSdkSessions(sessions, nowMs);
}

export function recentPiSessionsFromSdkSessions(sessions: PiSessionInfo[], nowMs: number): RecentAgentSession[] {
  const cutoffMs = nowMs - 24 * 60 * 60 * 1000;
  return sessions
    .map((session): RecentAgentSession | null => {
      const modifiedMs = session.modified.getTime();
      if (!Number.isFinite(modifiedMs) || modifiedMs < cutoffMs) {
        return null;
      }
      const summary = buildPiSummary(session);
      const visibleMessages = summary.transcript.filter((message) => {
        return (message.role === "user" || message.role === "assistant") && message.text;
      });
      if (visibleMessages.some((message) => message.role === "user" && isStructuredSessionBriefPrompt(message.text))) {
        return null;
      }
      const lastMessage = visibleMessages
        .slice()
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
      const lastMessageMs = lastMessage ? Date.parse(lastMessage.createdAt) : modifiedMs;
      if (!lastMessage || !Number.isFinite(lastMessageMs) || lastMessageMs < cutoffMs) {
        return null;
      }
      const preview = recentSessionPreviewFromMessages(visibleMessages);
      return {
        provider: "pi",
        id: session.path,
        title: String(session.name || session.firstMessage || "Pi session").slice(0, 120),
        cwd: String(session.cwd || ""),
        updatedAt: session.modified.toISOString(),
        lastMessageAt: new Date(lastMessageMs).toISOString(),
        lastMessageText: lastMessage.text.slice(0, 240),
        initialUserText: preview.initialUserText || String(session.firstMessage || ""),
        initialUserAt: preview.initialUserAt || session.created.toISOString(),
        latestUserText: preview.latestUserText || String(session.firstMessage || ""),
        latestUserAt: preview.latestUserAt || session.created.toISOString(),
        userMessageCount: Math.max(preview.userMessageCount, session.firstMessage ? 1 : 0),
        latestAssistantText: preview.latestAssistantText,
        latestAssistantAt: preview.latestAssistantAt,
        messageCount: visibleMessages.length,
        status: lastMessage.role === "user" ? "busy" : "idle",
        archived: false,
        command: "pi",
        args: ["--session", session.path],
      };
    })
    .filter((session): session is RecentAgentSession => Boolean(session))
    .sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt));
}

export function resolvePiSession(input: ResolvePiSessionInput) {
  const explicitSession = getExplicitPiSession(input.args);
  if (explicitSession) {
    const exact = input.sessions.find((candidate) => candidate.path === explicitSession || candidate.id === explicitSession);
    if (exact) {
      return exact;
    }
  }

  const matchingDirectory = input.sessions.filter((candidate) => samePath(candidate.cwd, input.cwd));
  const candidates = matchingDirectory.length ? matchingDirectory : input.sessions;
  const tuiStartedAt = new Date(input.tuiCreatedAt).getTime();
  const createdAfterLaunch = candidates.filter((candidate) => candidate.created.getTime() >= tuiStartedAt - 10_000);

  if (input.currentExternalSessionId) {
    const existing = createdAfterLaunch.find((candidate) => candidate.path === input.currentExternalSessionId || candidate.id === input.currentExternalSessionId);
    if (existing) {
      return existing;
    }
  }

  return createdAfterLaunch
    .slice()
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())[0] || null;
}

export function buildPiSummary(session: PiSessionInfo): AgentSessionSummary {
  const context: { messages: any[] } = readPiSessionContext(session.path);
  const transcript = context.messages.map((message: any, index: number) => ({
    id: `${session.path}:${index}`,
    role: String(message.role || ""),
    createdAt: message.timestamp ? new Date(Number(message.timestamp)).toISOString() : session.modified.toISOString(),
    text: extractPiMessageText(message).trim().slice(0, 20_000),
  })).filter((message) => message.text);
  const userMessages = transcript.filter((message) => message.role === "user" && message.text);
  const assistantMessages = transcript.filter((message) => message.role === "assistant" && message.text);
  return {
    provider: "pi",
    title: String(session.name || session.firstMessage || "Pi session").slice(0, 200),
    forkPoint: transcript.at(-1)?.id || "",
    messageCount: transcript.length,
    diffCount: 0,
    additions: 0,
    deletions: 0,
    latestUserText: (userMessages.at(-1)?.text || String(session.firstMessage || "")).slice(0, 20_000),
    latestAssistantText: (assistantMessages.at(-1)?.text || "").slice(0, 20_000),
    sessionBrief: null,
    transcript: transcript.slice(-80),
    diffs: [],
  };
}

export function buildPiSidecarSummary(sessionId: string, finalResponse: string): AgentSessionSummary {
  const now = new Date().toISOString();
  const text = finalResponse.trim();
  return {
    provider: "pi",
    title: "Pi sidecar summary",
    forkPoint: text ? `${sessionId}-summary` : "",
    messageCount: text ? 1 : 0,
    diffCount: 0,
    additions: 0,
    deletions: 0,
    latestUserText: "",
    latestAssistantText: text,
    sessionBrief: text ? parseStructuredSessionBrief(text) : null,
    transcript: text ? [{ id: `${sessionId}-summary`, role: "assistant", createdAt: now, text }] : [],
    diffs: [],
  };
}

export function createPiSummaryPrompt(summary: AgentSessionSummary) {
  return createStructuredSessionBriefPrompt("Pi", summary);
}

export async function runPiSidecarSummary(input: {
  sourceSessionPath: string;
  cwd: string;
  prompt: string;
}) {
  const { createAgentSession, SessionManager } = await loadPiSdk();
  const forkManager = SessionManager.forkFrom(input.sourceSessionPath, input.cwd);
  const { session } = await createAgentSession({ sessionManager: forkManager, tools: [] });
  let finalResponse = "";
  try {
    await session.prompt(input.prompt);
    finalResponse = session.messages
      .filter((message: any) => message.role === "assistant")
      .map((message: any) => extractPiMessageText(message))
      .filter(Boolean)
      .at(-1) || "";
    return {
      forkSessionId: session.sessionFile || forkManager.getSessionFile() || "",
      finalResponse,
    };
  } finally {
    session.dispose();
  }
}

export function discardPiSessionFile(sessionPath: string) {
  if (!sessionPath) {
    return false;
  }
  try {
    fs.rmSync(sessionPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

let loadedPiSdk: any = null;

async function loadPiSdk() {
  if (!loadedPiSdk) {
    loadedPiSdk = await import("@earendil-works/pi-coding-agent");
  }
  return loadedPiSdk;
}

function readPiSessionContext(sessionPath: string) {
  if (loadedPiSdk) {
    const manager = loadedPiSdk.SessionManager.open(sessionPath);
    return manager.buildSessionContext();
  }
  const entries = fs.readFileSync(sessionPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    messages: entries
      .filter((entry) => entry.type === "message" && entry.message)
      .map((entry) => entry.message),
  };
}

function extractPiMessageText(message: any): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (message.role === "bashExecution") {
    return `[bash ${String(message.command || "")}]
${String(message.output || "")}`.trim();
  }
  if (message.role === "custom") {
    return extractPiContentText(message.content);
  }
  if (message.role === "branchSummary") {
    return String(message.summary || "");
  }
  if (message.role === "compactionSummary") {
    return String(message.summary || "");
  }
  return extractPiContentText(message.content);
}

function extractPiContentText(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => {
    if (!part || typeof part !== "object") {
      return "";
    }
    if (part.type === "text") {
      return String(part.text || "");
    }
    if (part.type === "thinking") {
      return "[thinking]";
    }
    if (part.type === "toolCall") {
      return `[tool ${String(part.name || part.id || "")}]`;
    }
    if (part.type === "image") {
      return "[image]";
    }
    if (part.type) {
      return `[${String(part.type)}]`;
    }
    return "";
  }).filter(Boolean).join("\n");
}

function getExplicitPiSession(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] || "";
    if (arg === "--session" || arg === "--session-id" || arg === "--resume" || arg === "-r" || arg === "resume") {
      const next = args[index + 1] || "";
      return next && !next.startsWith("-") ? next : "";
    }
    if (arg.startsWith("--session=")) {
      return arg.slice("--session=".length);
    }
    if (arg.startsWith("--session-id=")) {
      return arg.slice("--session-id=".length);
    }
    if (arg.startsWith("--resume=")) {
      return arg.slice("--resume=".length);
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
