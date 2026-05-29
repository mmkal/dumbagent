import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { recentPiSessionsFromSdkSessions, resolvePiSession, type PiSessionInfo } from "../src/pi-sdk.ts";


test("does not resolve a stale Pi session before the launched TUI session is visible", () => {
  const session = resolvePiSession({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "",
    args: [],
    sessions: [
      piSession("stale-session", "/repo", "2026-05-08T13:00:00.000Z", "2026-05-08T14:29:30.000Z"),
    ],
  });

  expect(session).toBeNull();
});

test("does not keep a stale pinned Pi session once the launched TUI session appears", () => {
  const session = resolvePiSession({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "stale-session",
    args: [],
    sessions: [
      piSession("stale-session", "/repo", "2026-05-08T13:00:00.000Z", "2026-05-08T14:29:30.000Z"),
      piSession("launched-tui", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z"),
    ],
  });

  expect(session).toMatchObject({ id: "launched-tui" });
});

test("maps Pi SDK session listings into recent agent sessions", () => {
  using workspace = createTempDirectory("tuiui-pi-sdk-test-");
  const sessionPath = path.join(workspace.path, "pi-session.jsonl");
  fs.writeFileSync(sessionPath, [
    JSON.stringify({ type: "session", version: 3, id: "pi-session-id", timestamp: "2026-05-08T14:28:00.000Z", cwd: "/repo" }),
    JSON.stringify({ type: "message", id: "user0001", parentId: null, timestamp: "2026-05-08T14:28:01.000Z", message: { role: "user", content: "ship pi support", timestamp: Date.parse("2026-05-08T14:28:01.000Z") } }),
    JSON.stringify({ type: "message", id: "asst0001", parentId: "user0001", timestamp: "2026-05-08T14:28:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "pi support is wired" }], timestamp: Date.parse("2026-05-08T14:28:02.000Z"), api: "test", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
  ].join("\n"));

  const sessions = recentPiSessionsFromSdkSessions([
    {
      path: sessionPath,
      id: "pi-session-id",
      cwd: "/repo",
      name: "Pi handoff",
      created: new Date("2026-05-08T14:28:00.000Z"),
      modified: new Date("2026-05-08T14:28:30.000Z"),
      messageCount: 2,
      firstMessage: "ship pi support",
      allMessagesText: "ship pi support\npi support is wired",
    },
  ], Date.parse("2026-05-08T15:00:00.000Z"));

  expect(sessions).toMatchObject([
    {
      provider: "pi",
      id: sessionPath,
      title: "Pi handoff",
      cwd: "/repo",
      initialUserText: "ship pi support",
      latestUserText: "ship pi support",
      latestAssistantText: "pi support is wired",
      messageCount: 2,
      status: "idle",
      command: "pi",
      args: ["--session", sessionPath],
    },
  ]);
});

function piSession(id: string, cwd: string, createdAt: string, modifiedAt: string): PiSessionInfo {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd,
    name: id,
    created: new Date(createdAt),
    modified: new Date(modifiedAt),
    messageCount: 0,
    firstMessage: "",
    allMessagesText: "",
  };
}

function createTempDirectory(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
