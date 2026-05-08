// Inspired by ../xyz's Bun browser-session CLI, but this project deliberately
// uses Bun's PTY support directly instead of tmux. xyz remains the reference
// for the session browser and command/chord interaction ideas.
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { createFakeAgent, parseRequest, type AgentName, type FakeAgent } from "fakeagent";
import homepage from "./public/index.html";
import { formatFakeAgentFallback } from "./src/fakeagent-response.ts";
import {
  buildOpenCodeSummary,
  pickOpenCodeModel,
  resolveOpenCodeSession,
  type AgentSessionSummary,
  type SessionSdkPayload,
} from "./src/opencode-sdk.ts";
import { createSessionId } from "./src/session-id.ts";
import { analyzeTerminalScreen, type SemanticScreen } from "./src/semantic-screen.ts";
import { analyzeTerminalBlocks, type TerminalBlockModel } from "./src/terminal-blocks.ts";

if (typeof Bun === "undefined") {
  throw new Error("tuiui requires the Bun runtime. Run `bun run cli.ts ...`.");
}

type SessionLifecycle = "running" | "exited";
type SessionStatus = "busy" | "idle" | "exited";

type StdoutEvent = {
  id: number;
  chunk: string;
  displayText: string;
  createdAt: string;
};

type StdinEvent = {
  id: number;
  text: string;
  createdAt: string;
};

type SessionPayload = {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  lastOutputAt: string;
  lifecycle: SessionLifecycle;
  status: SessionStatus;
  exitCode: number | null;
  cols: number;
  rows: number;
  renderedText: string;
  renderedHtml: string;
  blocks: TerminalBlockModel;
  semantic: SemanticScreen;
  sdk: SessionSdkPayload;
  stdinEvents: StdinEvent[];
  stdoutEvents: StdoutEvent[];
};

type RuntimeSession = {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  lastOutputAt: string;
  lifecycle: SessionLifecycle;
  exitCode: number | null;
  cols: number;
  rows: number;
  terminal: HeadlessTerminal;
  serializer: SerializeAddon;
  outputDecoder: StringDecoder;
  process: any;
  writeQueue: Promise<void>;
  renderedText: string;
  renderedHtml: string;
  blocks: TerminalBlockModel;
  semantic: SemanticScreen;
  sdk: SessionSdkPayload;
  stdinEvents: StdinEvent[];
  stdoutEvents: StdoutEvent[];
  subscribers: Set<(payload: SessionPayload) => void>;
  fakeAgent: FakeAgent | null;
};

type CreateSessionInput = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  fakeAgent: AgentName | "";
};

type ServerState = {
  sessions: Map<string, RuntimeSession>;
  nextStdoutEventId: number;
  nextStdinEventId: number;
};

const host = "127.0.0.1";
const defaultPort = 7373;
const defaultCols = 120;
const defaultRows = 42;
const idleThresholdMs = 1_000;

const cli = parseCliArgs(process.argv.slice(2));
const state: ServerState = {
  sessions: new Map(),
  nextStdoutEventId: 1,
  nextStdinEventId: 1,
};
const server: ReturnType<typeof Bun.serve> = startServer({ port: cli.port, state });
const baseUrl = `http://${host}:${server.port}`;

if (cli.rest.length > 0) {
  const [command, ...args] = cli.rest;
  const session = await createSession({
    command: command || "",
    args,
    cwd: process.cwd(),
    env: {},
    cols: defaultCols,
    rows: defaultRows,
    fakeAgent: cli.fakeAgent,
  });
  const sessionUrl = `${baseUrl}/sessions/${session.id}`;
  process.stdout.write(`${sessionUrl}\n`);
  if (cli.open) {
    openUrl(sessionUrl);
  }
} else {
  process.stdout.write(`${baseUrl}\n`);
  if (cli.open) {
    openUrl(baseUrl);
  }
}

process.on("SIGTERM", () => void shutdown(server, state));
process.on("SIGINT", () => void shutdown(server, state));

await new Promise(() => {});

function startServer(options: { port: number; state: ServerState }): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: options.port,
    hostname: host,
    development: true,
    routes: {
      "/": homepage,
      "/sessions": homepage,
      "/sessions/:id": homepage,
      "/health": {
        GET: () => Response.json({ ok: true }),
      },
    },
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        return new Response("not found", { status: 404 });
      }
      try {
        return await handleApiRequest(options.state, request, url);
      } catch (error) {
        return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
      }
    },
  });
}

async function handleApiRequest(state: ServerState, request: Request, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/cwd") {
    return Response.json({ cwd: fs.realpathSync(process.cwd()) });
  }

  if (request.method === "GET" && url.pathname === "/api/commands") {
    return Response.json([
      { id: "custom", label: "Custom", command: "", args: [], fakeAgent: "" },
      { id: "fake-opencode", label: "Fake OpenCode", command: "opencode", args: [], fakeAgent: "opencode" },
      { id: "ghui", label: "ghui", command: "ghui", args: [], fakeAgent: "" },
    ]);
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    return Response.json([...state.sessions.values()].map(toSessionListItem));
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const body = await request.json() as Partial<CreateSessionInput>;
    const session = await createSession({
      command: body.command || "",
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      cwd: body.cwd || process.cwd(),
      env: body.env || {},
      cols: Number(body.cols || defaultCols),
      rows: Number(body.rows || defaultRows),
      fakeAgent: isAgentName(body.fakeAgent) ? body.fakeAgent : "",
    });
    return Response.json({ id: session.id, url: `${baseUrl}/sessions/${session.id}` });
  }

  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return new Response("not found", { status: 404 });
  }

  const session = state.sessions.get(match[1] || "");
  if (!session) {
    return Response.json({ error: "unknown session" }, { status: 404 });
  }

  const action = match[2] || "";

  if (request.method === "GET" && !action) {
    return Response.json(getSessionPayload(session));
  }

  if (request.method === "GET" && action === "events") {
    return streamSessionEvents(session);
  }

  if (request.method === "POST" && action === "send") {
    const body = await request.json() as { text?: string; submit?: boolean };
    await sendToSession(state, session, String(body.text || ""), body.submit !== false);
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && action === "sdk-refresh") {
    await refreshSessionSdk(session);
    return Response.json(getSessionPayload(session));
  }

  if (request.method === "POST" && action === "sdk-summarize") {
    await summarizeSessionWithSdk(session);
    return Response.json(getSessionPayload(session));
  }

  if (request.method === "POST" && action === "key") {
    const body = await request.json() as { key?: string };
    await sendToSession(state, session, resolveKeySequence(String(body.key || "")), false);
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && action === "resize") {
    const body = await request.json() as { cols?: number; rows?: number };
    await resizeSession(session, Number(body.cols || session.cols), Number(body.rows || session.rows));
    publishSession(session);
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && action === "kill") {
    await killSession(session);
    return Response.json({ ok: true });
  }

  return new Response("not found", { status: 404 });
}

async function createSession(input: CreateSessionInput) {
  if (!input.command.trim()) {
    throw new Error("command is required");
  }
  const cwd = path.resolve(input.cwd);
  const cwdStats = fs.statSync(cwd);
  if (!cwdStats.isDirectory()) {
    throw new Error(`cwd is not a directory: ${cwd}`);
  }

  const id = createSessionId();
  const now = new Date().toISOString();
  const cols = Math.max(40, Math.min(240, Math.round(input.cols)));
  const rows = Math.max(12, Math.min(80, Math.round(input.rows)));
  const terminal = new HeadlessTerminal({ cols, rows, scrollback: 2_000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);

  let command = input.command;
  let args = input.args;
  let env: Record<string, string> = {
    ...minimalEnv(process.env),
    ...input.env,
    TERM: input.env.TERM || process.env.TERM || "xterm-256color",
  };
  let fakeAgent: FakeAgent | null = null;

  if (input.fakeAgent) {
    fakeAgent = await createTestingFakeAgent();
    const fakeSpawn = fakeAgent.getSpawnArgs(input.fakeAgent);
    command = fakeSpawn.command;
    args = [...fakeSpawn.args, ...input.args];
    const fakeAgentRoot = path.join("/tmp", "tuiui-fakeagent", id);
    env = {
      ...env,
      ...fakeSpawn.env,
      XDG_CONFIG_HOME: path.join(fakeAgentRoot, "config"),
      XDG_DATA_HOME: path.join(fakeAgentRoot, "data"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    };
    prepareFakeAgentWorkspace(cwd);
  }

  const sdk = await prepareSessionSdk(command, args);
  command = sdk.command;
  args = sdk.args;

  const session: RuntimeSession = {
    id,
    title: path.basename(command),
    command,
    args,
    cwd,
    createdAt: now,
    updatedAt: now,
    lastOutputAt: now,
    lifecycle: "running",
    exitCode: null,
    cols,
    rows,
    terminal,
    serializer,
    outputDecoder: new StringDecoder("utf8"),
    process: null,
    writeQueue: Promise.resolve(),
    renderedText: "",
    renderedHtml: "",
    blocks: analyzeTerminalBlocks(terminal),
    semantic: analyzeTerminalScreen("", { cols, rows }),
    sdk: sdk.payload,
    stdinEvents: [],
    stdoutEvents: [],
    subscribers: new Set(),
    fakeAgent,
  };

  state.sessions.set(id, session);

  session.process = Bun.spawn([command, ...args], {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      data(_term: unknown, chunk: string | Uint8Array) {
        const text = typeof chunk === "string" ? chunk : session.outputDecoder.write(Buffer.from(chunk));
        session.writeQueue = session.writeQueue.then(() => appendOutput(state, session, text));
      },
    },
  });

  session.process.exited.then((exitCode: number) => {
    session.writeQueue = session.writeQueue
      .then(async () => {
        const flushed = session.outputDecoder.end();
        if (flushed) {
          await appendOutput(state, session, flushed);
        }
        session.lifecycle = "exited";
        session.exitCode = exitCode;
        session.updatedAt = new Date().toISOString();
        await session.fakeAgent?.[Symbol.asyncDispose]();
        publishSession(session);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  });

  publishSession(session);
  return session;
}

async function appendOutput(state: ServerState, session: RuntimeSession, chunk: string) {
  if (!chunk) {
    return;
  }
  await writeToTerminal(session.terminal, chunk);
  const now = new Date().toISOString();
  const renderedText = renderTerminalText(session);
  session.renderedText = renderedText;
  session.renderedHtml = session.serializer.serializeAsHTML({ includeGlobalBackground: true });
  session.blocks = analyzeTerminalBlocks(session.terminal);
  session.semantic = analyzeTerminalScreen(renderedText, { cols: session.cols, rows: session.rows });
  session.title = inferSessionTitle(session, chunk);
  session.updatedAt = now;
  session.lastOutputAt = now;
  session.stdoutEvents.push({
    id: state.nextStdoutEventId,
    chunk,
    displayText: sanitizeTerminalChunk(chunk),
    createdAt: now,
  });
  state.nextStdoutEventId += 1;
  publishSession(session);
}

async function writeToTerminal(terminal: HeadlessTerminal, chunk: string) {
  await new Promise<void>((resolve) => {
    terminal.write(chunk, () => resolve());
  });
}

function renderTerminalText(session: RuntimeSession) {
  const buffer = session.terminal.buffer.active;
  const start = Math.max(0, buffer.length - session.rows);
  const lines: string[] = [];
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

async function sendToSession(state: ServerState, session: RuntimeSession, text: string, submit: boolean) {
  if (session.lifecycle !== "running") {
    throw new Error("session is not running");
  }
  const now = new Date().toISOString();
  session.stdinEvents.push({
    id: state.nextStdinEventId,
    text,
    createdAt: now,
  });
  state.nextStdinEventId += 1;
  session.updatedAt = now;
  if (text.trim()) {
    session.title = session.title === path.basename(session.command) ? text.trim().slice(0, 100) : session.title;
  }

  if (submit && path.basename(session.command).toLowerCase() === "opencode" && text) {
    session.process.terminal.write(text);
    await delay(80);
    session.process.terminal.write("\n");
    await delay(80);
    session.process.terminal.write("\r");
    publishSession(session);
    return;
  }

  session.process.terminal.write(submit ? normalizeInput(text) : text);
  publishSession(session);
}

function normalizeInput(text: string) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n$/g, "");
  return `${normalized.replaceAll("\n", "\r")}\r`;
}

async function resizeSession(session: RuntimeSession, cols: number, rows: number) {
  session.cols = Math.max(40, Math.min(240, Math.round(cols)));
  session.rows = Math.max(12, Math.min(80, Math.round(rows)));
  session.terminal.resize(session.cols, session.rows);
  session.process.terminal.resize(session.cols, session.rows);
  session.renderedText = renderTerminalText(session);
  session.renderedHtml = session.serializer.serializeAsHTML({ includeGlobalBackground: true });
  session.blocks = analyzeTerminalBlocks(session.terminal);
  session.semantic = analyzeTerminalScreen(session.renderedText, { cols: session.cols, rows: session.rows });
  session.updatedAt = new Date().toISOString();
}

async function killSession(session: RuntimeSession) {
  if (session.lifecycle === "exited") {
    return;
  }
  try {
    session.process.terminal.write("\x03");
  } catch {
  }
  await delay(150);
  try {
    session.process.kill("SIGTERM");
  } catch {
  }
}

function publishSession(session: RuntimeSession) {
  const payload = getSessionPayload(session);
  for (const subscriber of session.subscribers) {
    subscriber(payload);
  }
}

function streamSessionEvents(session: RuntimeSession) {
  const encoder = new TextEncoder();
  let send = (_payload: SessionPayload) => {};
  const stream = new ReadableStream({
    start(controller) {
      send = (payload: SessionPayload) => {
        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      session.subscribers.add(send);
      send(getSessionPayload(session));
    },
    cancel() {
      session.subscribers.delete(send);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function getSessionPayload(session: RuntimeSession): SessionPayload {
  const status = session.lifecycle === "exited"
    ? "exited"
    : Date.now() - new Date(session.lastOutputAt).getTime() < idleThresholdMs
      ? "busy"
      : "idle";
  return {
    id: session.id,
    title: session.semantic.title || session.title,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastOutputAt: session.lastOutputAt,
    lifecycle: session.lifecycle,
    status,
    exitCode: session.exitCode,
    cols: session.cols,
    rows: session.rows,
    renderedText: session.renderedText,
    renderedHtml: session.renderedHtml,
    blocks: session.blocks,
    semantic: session.semantic,
    sdk: session.sdk,
    stdinEvents: session.stdinEvents.slice(-100),
    stdoutEvents: session.stdoutEvents.slice(-200),
  };
}

function toSessionListItem(session: RuntimeSession) {
  return {
    id: session.id,
    title: session.semantic.title || session.title,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    status: getSessionPayload(session).status,
    lifecycle: session.lifecycle,
    updatedAt: session.updatedAt,
  };
}

async function createTestingFakeAgent() {
  return await createFakeAgent({
    async fetch(request) {
      const parsed = await parseRequest(request);
      const text = parsed.lastMessage || "";
      if (/title generator/i.test(parsed.systemPrompt)) {
        return parsed.respond.text("TUI UI test");
      }
      if (parsed.body.messages?.some((message: any) => message.role === "tool")) {
        return parsed.respond.text("the file says hi");
      }
      if (/one plus two/i.test(text)) {
        return parsed.respond.text("three");
      }
      if (/four plus five/i.test(text)) {
        return parsed.respond.text("nine");
      }
      if (/read .*hello/i.test(text)) {
        return parsed.respond.toolCall("read", { filePath: path.join("/tmp/fakeagent-test", "hello.txt") });
      }
      return parsed.respond.text(formatFakeAgentFallback(text));
    },
  });
}

function prepareFakeAgentWorkspace(cwd: string) {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync("/tmp/fakeagent-test", { recursive: true });
  fs.writeFileSync("/tmp/fakeagent-test/hello.txt", "hi\n");
}

async function prepareSessionSdk(command: string, args: string[]) {
  if (!isOpenCodeCommand(command)) {
    return {
      command,
      args,
      payload: createUnavailableSdkPayload(),
    };
  }

  const prepared = [...args];
  const port = await ensureCliOption(prepared, "--port", async (current) => {
    const parsed = Number(current || 0);
    return parsed > 0 ? String(parsed) : String(await getFreePort());
  });
  await ensureCliOption(prepared, "--hostname", async (current) => current || host);
  const now = new Date().toISOString();

  return {
    command,
    args: prepared,
    payload: {
      provider: "opencode" as const,
      state: "ready" as const,
      baseUrl: `http://${host}:${port}`,
      externalSessionId: "",
      status: "",
      updatedAt: now,
      error: "",
      sidecarSummary: createIdleSidecarSummary(now),
      summary: null,
    },
  };
}

function createUnavailableSdkPayload(): SessionSdkPayload {
  return {
    provider: "",
    state: "unavailable",
    baseUrl: "",
    externalSessionId: "",
    status: "",
    updatedAt: "",
    error: "",
    sidecarSummary: createIdleSidecarSummary(""),
    summary: null,
  };
}

function createIdleSidecarSummary(updatedAt: string): SessionSdkPayload["sidecarSummary"] {
  return {
    implemented: false,
    status: "idle",
    method: "",
    providerSessionId: "",
    updatedAt,
    result: null,
    error: "",
    note: "No sidecar summary has been requested for this session.",
  };
}

async function ensureCliOption(args: string[], name: string, resolveValue: (current: string) => Promise<string>) {
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] || "";
    if (arg === name) {
      const value = await resolveValue(args[index + 1] || "");
      args[index + 1] = value;
      return value;
    }
    if (arg.startsWith(prefix)) {
      const value = await resolveValue(arg.slice(prefix.length));
      args[index] = `${name}=${value}`;
      return value;
    }
  }
  const value = await resolveValue("");
  args.push(name, value);
  return value;
}

function isOpenCodeCommand(command: string) {
  return path.basename(command).toLowerCase() === "opencode";
}

async function refreshSessionSdk(session: RuntimeSession) {
  if (session.sdk.provider !== "opencode") {
    session.sdk = createUnavailableSdkPayload();
    return;
  }

  try {
    const client = createOpenCodeClient(session);
    const sessions = responseData<any[]>(await client.session.list({ responseStyle: "data", throwOnError: true }));
    const target = resolveOpenCodeSession({
      sessions,
      cwd: session.cwd,
      tuiCreatedAt: session.createdAt,
      currentExternalSessionId: session.sdk.externalSessionId,
      args: session.args,
    });
    if (!target) {
      session.sdk = {
        ...session.sdk,
        state: "not-found",
        status: "",
        updatedAt: new Date().toISOString(),
        error: "OpenCode server is reachable, but no matching session is visible yet.",
        summary: null,
      };
      publishSession(session);
      return;
    }

    session.sdk.externalSessionId = String(target.id || "");
    const [statusBySession, messages, diffs] = await Promise.all([
      client.session.status({ responseStyle: "data", throwOnError: true }).then(responseData<Record<string, any>>).catch(() => ({} as Record<string, any>)),
      client.session.messages({
        path: { id: session.sdk.externalSessionId },
        responseStyle: "data",
        throwOnError: true,
      }).then(responseData<any[]>).catch(() => []),
      client.session.diff({
        path: { id: session.sdk.externalSessionId },
        responseStyle: "data",
        throwOnError: true,
      }).then(responseData<any[]>).catch(() => []),
    ]);

    const status = statusBySession[session.sdk.externalSessionId]?.type || "";
    session.sdk = {
      ...session.sdk,
      state: "connected",
      status,
      updatedAt: new Date().toISOString(),
      error: "",
      summary: buildOpenCodeSummary(target, messages, diffs),
    };
    if (!session.title || session.title === path.basename(session.command)) {
      session.title = session.sdk.summary?.title || session.title;
    }
  } catch (error) {
    session.sdk = {
      ...session.sdk,
      state: "error",
      updatedAt: new Date().toISOString(),
      error: String(error instanceof Error ? error.message : error),
    };
  }
  publishSession(session);
}

async function summarizeSessionWithSdk(session: RuntimeSession) {
  if (session.sdk.provider !== "opencode") {
    session.sdk = createUnavailableSdkPayload();
    publishSession(session);
    return;
  }

  session.sdk = {
    ...session.sdk,
    sidecarSummary: {
      implemented: true,
      status: "running",
      method: "opencode.session.summarize",
      providerSessionId: session.sdk.externalSessionId,
      updatedAt: new Date().toISOString(),
      result: null,
      error: "",
      note: "Calling OpenCode session.summarize for the matched provider session.",
    },
  };
  publishSession(session);

  try {
    const client = createOpenCodeClient(session);
    const sessions = responseData<any[]>(await client.session.list({ responseStyle: "data", throwOnError: true }));
    const target = resolveOpenCodeSession({
      sessions,
      cwd: session.cwd,
      tuiCreatedAt: session.createdAt,
      currentExternalSessionId: session.sdk.externalSessionId,
      args: session.args,
    });
    if (!target) {
      throw new Error("OpenCode server is reachable, but no matching session is visible yet.");
    }

    const providerSessionId = String(target.id || "");
    session.sdk.externalSessionId = providerSessionId;
    const messages = responseData<any[]>(await client.session.messages({
      path: { id: providerSessionId },
      responseStyle: "data",
      throwOnError: true,
    }));
    const model = pickOpenCodeModel(messages);
    if (!model) {
      throw new Error("OpenCode session has no model metadata yet; send a prompt before summarizing.");
    }

    const result = responseData<boolean>(await client.session.summarize({
      path: { id: providerSessionId },
      body: model,
      responseStyle: "data",
      throwOnError: true,
    }));
    session.sdk = {
      ...session.sdk,
      externalSessionId: providerSessionId,
      sidecarSummary: {
        implemented: true,
        status: "completed",
        method: "opencode.session.summarize",
        providerSessionId,
        updatedAt: new Date().toISOString(),
        result,
        error: "",
        note: "OpenCode session.summarize compacts the provider session; providerData is refreshed after completion.",
      },
    };
    await refreshSessionSdk(session);
  } catch (error) {
    session.sdk = {
      ...session.sdk,
      sidecarSummary: {
        implemented: true,
        status: "error",
        method: "opencode.session.summarize",
        providerSessionId: session.sdk.externalSessionId,
        updatedAt: new Date().toISOString(),
        result: null,
        error: String(error instanceof Error ? error.message : error),
        note: "OpenCode session.summarize failed before producing a sidecar summary result.",
      },
    };
    publishSession(session);
  }
}

function createOpenCodeClient(session: RuntimeSession) {
  return createOpencodeClient({
    baseUrl: session.sdk.baseUrl,
    directory: session.cwd,
  });
}

function responseData<T>(value: any): T {
  return value && typeof value === "object" && "data" in value ? value.data as T : value as T;
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function inferSessionTitle(session: RuntimeSession, chunk: string) {
  const oscTitle = parseOscTitle(chunk);
  if (oscTitle) {
    return oscTitle;
  }
  return session.semantic.title || session.title;
}

function parseOscTitle(chunk: string) {
  const match = chunk.match(/\x1b\][02];([^\x07\x1b]*?)(?:\x07|\x1b\\)/);
  return match ? match[1]!.trim() : "";
}

function sanitizeTerminalChunk(chunk: string) {
  const stripped = stripVTControlCharacters(chunk.replace(/\x1b\[(\d+)C/g, (_match, amount) => " ".repeat(Number(amount))))
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return /\S/.test(stripped) ? stripped : "";
}

function resolveKeySequence(key: string) {
  switch (key.toLowerCase()) {
    case "esc":
    case "escape":
      return "\x1b";
    case "tab":
      return "\t";
    case "enter":
    case "return":
      return "\r";
    case "backspace":
      return "\x7f";
    case "up":
      return "\x1b[A";
    case "down":
      return "\x1b[B";
    case "left":
      return "\x1b[D";
    case "right":
      return "\x1b[C";
    case "ctrl+c":
      return "\x03";
    case "ctrl+d":
      return "\x04";
    default:
      return key;
  }
}

function minimalEnv(env: NodeJS.ProcessEnv) {
  const entries = Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

function isAgentName(value: unknown): value is AgentName {
  return value === "opencode" || value === "claude" || value === "codex";
}

function parseCliArgs(argv: string[]) {
  let port = Number(process.env.TUIUI_PORT || defaultPort);
  let open = false;
  let fakeAgent: AgentName | "" = "";
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] || "";
    if (arg === "daemon") {
      continue;
    }
    if (arg === "--open") {
      open = true;
      continue;
    }
    if (arg === "--port") {
      port = Number(argv[index + 1] || port);
      index += 1;
      continue;
    }
    if (arg === "--fakeagent") {
      const candidate = argv[index + 1] || "";
      fakeAgent = isAgentName(candidate) ? candidate : "";
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  return { port, open, fakeAgent, rest };
}

function openUrl(url: string) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  child.unref();
}

async function shutdown(runningServer: ReturnType<typeof Bun.serve>, state: ServerState) {
  for (const session of state.sessions.values()) {
    await killSession(session).catch(() => {});
    if (session.fakeAgent) {
      await Promise.resolve(session.fakeAgent[Symbol.asyncDispose]()).catch(() => {});
    }
  }
  runningServer.stop(true);
  process.exit(0);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
