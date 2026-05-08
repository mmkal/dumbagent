import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  buildCodexSummary,
  readCodexThreadsFromDatabasePath,
  resolveCodexStateDatabasePathForEnv,
  resolveCodexThread,
  type CodexThreadRow,
} from "../src/codex-sdk.ts";

test("prefers the Codex thread created for this TUI over stale threads in the same directory", () => {
  const thread = resolveCodexThread({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "",
    args: [],
    threads: [
      codexThread("old-thread", "/repo", "2026-05-06T19:19:08.000Z", "2026-05-08T14:28:30.000Z", ""),
      codexThread("new-thread", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z", ""),
    ],
  });

  expect(thread).toMatchObject({ id: "new-thread" });
});

test("keeps the resolved Codex source thread when a newer sidecar exists", () => {
  const thread = resolveCodexThread({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "source-thread",
    args: [],
    threads: [
      codexThread("source-thread", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z", ""),
      codexThread("sidecar-summary", "/repo", "2026-05-08T14:29:00.000Z", "2026-05-08T14:29:30.000Z", ""),
    ],
  });

  expect(thread).toMatchObject({ id: "source-thread" });
});

test("does not resolve a stale supervising Codex thread before the launched TUI thread is visible", () => {
  const thread = resolveCodexThread({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "",
    args: [],
    threads: [
      codexThread("this-session", "/repo", "2026-05-08T13:00:00.000Z", "2026-05-08T14:29:30.000Z", ""),
    ],
  });

  expect(thread).toBeNull();
});

test("does not keep a stale pinned Codex thread once the launched TUI thread appears", () => {
  const thread = resolveCodexThread({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "this-session",
    args: [],
    threads: [
      codexThread("this-session", "/repo", "2026-05-08T13:00:00.000Z", "2026-05-08T14:29:30.000Z", ""),
      codexThread("launched-tui", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z", ""),
    ],
  });

  expect(thread).toMatchObject({ id: "launched-tui" });
});

test("honors an explicit Codex resume thread id", () => {
  const thread = resolveCodexThread({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "",
    args: ["resume", "chosen-thread"],
    threads: [
      codexThread("chosen-thread", "/repo", "2026-05-06T19:19:08.000Z", "2026-05-08T14:28:30.000Z", ""),
      codexThread("new-thread", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z", ""),
    ],
  });

  expect(thread).toMatchObject({ id: "chosen-thread" });
});

test("resolves an empty CODEX_HOME to the state database Codex will create there", () => {
  using workspace = createTempWorkspace();

  expect(resolveCodexStateDatabasePathForEnv({
    CODEX_HOME: workspace.path,
    HOME: path.join(workspace.path, "home"),
  })).toBe(path.join(workspace.path, "state_5.sqlite"));
});

test("repairs a stored CODEX_HOME .codex database path when Codex creates the sibling state database", () => {
  using workspace = createTempWorkspace();
  const codexHome = path.join(workspace.path, "codex-home");
  const actualDatabasePath = path.join(codexHome, "state_5.sqlite");
  createCodexThreadDatabase(actualDatabasePath, codexThread(
    "launched-tui",
    "/repo",
    "2026-05-08T14:28:05.000Z",
    "2026-05-08T14:28:10.000Z",
    "",
  ));

  const threads = readCodexThreadsFromDatabasePath(path.join(codexHome, ".codex", "state_5.sqlite"));

  expect(threads).toMatchObject([{ id: "launched-tui" }]);
});

test("builds a Codex summary from rollout messages without treating AGENTS as the latest user message", () => {
  using workspace = createTempWorkspace();
  const rolloutPath = path.join(workspace.path, "rollout.jsonl");
  fs.writeFileSync(rolloutPath, [
    rolloutMessage("2026-05-08T14:28:01.000Z", "user", "# AGENTS.md instructions\ninternal setup"),
    rolloutMessage("2026-05-08T14:28:02.000Z", "user", "ship codex summaries"),
    rolloutMessage("2026-05-08T14:28:03.000Z", "assistant", "working on it"),
    rolloutMessage("2026-05-08T14:28:04.000Z", "user", "make it sidecar"),
    rolloutMessage("2026-05-08T14:28:05.000Z", "assistant", "sidecar is wired"),
  ].join("\n"));

  const summary = buildCodexSummary(codexThread(
    "source-thread",
    "/repo",
    "2026-05-08T14:28:00.000Z",
    "2026-05-08T14:28:05.000Z",
    rolloutPath,
  ));

  expect(summary).toMatchObject({
    provider: "codex",
    title: "Codex test thread",
    messageCount: 5,
    latestUserText: "make it sidecar",
    latestAssistantText: "sidecar is wired",
    transcript: [
      { role: "user", text: "# AGENTS.md instructions\ninternal setup" },
      { role: "user", text: "ship codex summaries" },
      { role: "assistant", text: "working on it" },
      { role: "user", text: "make it sidecar" },
      { role: "assistant", text: "sidecar is wired" },
    ],
  });
});

function codexThread(id: string, cwd: string, createdAt: string, updatedAt: string, rolloutPath: string): CodexThreadRow {
  return {
    id,
    rollout_path: rolloutPath,
    created_at: Math.floor(new Date(createdAt).getTime() / 1000),
    updated_at: Math.floor(new Date(updatedAt).getTime() / 1000),
    source: "cli",
    model_provider: "openai",
    cwd,
    title: "Codex test thread",
    tokens_used: 0,
    first_user_message: "ship codex summaries",
    model: "gpt-5.5",
    reasoning_effort: "medium",
    created_at_ms: new Date(createdAt).getTime(),
    updated_at_ms: new Date(updatedAt).getTime(),
  };
}

function rolloutMessage(timestamp: string, role: string, text: string) {
  return JSON.stringify({
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{
        type: role === "assistant" ? "output_text" : "input_text",
        text,
      }],
    },
  });
}

function createCodexThreadDatabase(databasePath: string, thread: CodexThreadRow) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.exec(`
      create table threads (
        id text primary key,
        rollout_path text not null,
        created_at integer not null,
        updated_at integer not null,
        source text not null,
        model_provider text not null,
        cwd text not null,
        title text not null,
        tokens_used integer not null,
        first_user_message text not null,
        model text,
        reasoning_effort text,
        created_at_ms integer,
        updated_at_ms integer,
        archived integer not null default 0
      );
      insert into threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        tokens_used, first_user_message, model, reasoning_effort, created_at_ms, updated_at_ms, archived
      ) values (
        '${sqlString(thread.id)}',
        '${sqlString(thread.rollout_path)}',
        ${thread.created_at},
        ${thread.updated_at},
        '${sqlString(thread.source)}',
        '${sqlString(thread.model_provider)}',
        '${sqlString(thread.cwd)}',
        '${sqlString(thread.title)}',
        ${thread.tokens_used},
        '${sqlString(thread.first_user_message)}',
        '${sqlString(thread.model)}',
        '${sqlString(thread.reasoning_effort)}',
        ${thread.created_at_ms},
        ${thread.updated_at_ms},
        0
      );
    `);
  } finally {
    database.close();
  }
}

function sqlString(value: string) {
  return value.replaceAll("'", "''");
}

function createTempWorkspace() {
  const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuiui-codex-sdk-"));
  return {
    path: tempPath,
    [Symbol.dispose]() {
      fs.rmSync(tempPath, { recursive: true, force: true });
    },
  };
}
