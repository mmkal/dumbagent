import { expect, test } from "bun:test";
import { buildOpenCodeSummary, recentOpenCodeSessionsFromRows, resolveOpenCodeSession } from "../src/opencode-sdk.ts";

test("prefers the OpenCode session created for this TUI over stale sessions in the same directory", () => {
  const session = resolveOpenCodeSession({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "old-session",
    args: [],
    sessions: [
      providerSession("old-session", "/repo", "2026-05-06T19:19:08.000Z", "2026-05-08T14:28:30.000Z"),
      providerSession("new-session", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z"),
    ],
  });

  expect(session).toMatchObject({ id: "new-session" });
});

test("honors an explicit OpenCode --session argument", () => {
  const session = resolveOpenCodeSession({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "",
    args: ["--session", "chosen-session"],
    sessions: [
      providerSession("chosen-session", "/repo", "2026-05-06T19:19:08.000Z", "2026-05-08T14:28:30.000Z"),
      providerSession("new-session", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z"),
    ],
  });

  expect(session).toMatchObject({ id: "chosen-session" });
});

test("keeps the resolved OpenCode source session when a newer fork exists", () => {
  const session = resolveOpenCodeSession({
    cwd: "/repo",
    tuiCreatedAt: "2026-05-08T14:28:00.000Z",
    currentExternalSessionId: "source-session",
    args: [],
    sessions: [
      providerSession("source-session", "/repo", "2026-05-08T14:28:05.000Z", "2026-05-08T14:28:10.000Z"),
      providerSession("summary-fork", "/repo", "2026-05-08T14:29:00.000Z", "2026-05-08T14:29:30.000Z"),
    ],
  });

  expect(session).toMatchObject({ id: "source-session" });
});

test("does not treat compaction as the latest user message", () => {
  const summary = buildOpenCodeSummary(
    { title: "TUI UI test" },
    [
      message("user", "first real prompt"),
      message("assistant", "first answer"),
      message("user", "[compaction]"),
      message("assistant", "summary internals"),
    ],
    [],
  );

  expect(summary).toMatchObject({
    latestUserText: "first real prompt",
    latestAssistantText: "summary internals",
  });
});

test("lists recent OpenCode sessions by latest visible message", () => {
  const sessions = recentOpenCodeSessionsFromRows([
    {
      session: { id: "older", directory: "/repo", title: "Older OpenCode", time_updated: Date.parse("2026-05-11T09:45:00.000Z") },
      messages: [messageAt("user", "resume opencode on mobile", "2026-05-11T09:30:00.000Z")],
    },
    {
      session: { id: "stale", directory: "/repo", title: "Stale OpenCode", time_updated: Date.parse("2026-05-09T09:45:00.000Z") },
      messages: [messageAt("user", "too old", "2026-05-09T09:30:00.000Z")],
    },
    {
      session: { id: "newest", directory: "/repo", title: "Newest OpenCode", time_updated: Date.parse("2026-05-11T11:59:00.000Z") },
      messages: [
        messageAt("user", "[compaction]", "2026-05-11T11:58:00.000Z"),
        messageAt("assistant", "opencode is now in the launcher", "2026-05-11T11:59:00.000Z"),
      ],
    },
  ], Date.parse("2026-05-11T12:00:00.000Z"));

  expect(sessions).toMatchObject([
    {
      provider: "opencode",
      id: "newest",
      lastMessageAt: "2026-05-11T11:59:00.000Z",
      lastMessageText: "opencode is now in the launcher",
      command: "opencode",
      args: ["--session", "newest"],
    },
    {
      provider: "opencode",
      id: "older",
      lastMessageAt: "2026-05-11T09:30:00.000Z",
      lastMessageText: "resume opencode on mobile",
    },
  ]);
});

function providerSession(id: string, directory: string, createdAt: string, updatedAt: string) {
  return {
    id,
    directory,
    time: {
      created: new Date(createdAt).getTime(),
      updated: new Date(updatedAt).getTime(),
    },
  };
}

function message(role: string, text: string) {
  return {
    info: {
      id: `${role}-${text}`,
      role,
      time: { created: Date.now() },
    },
    parts: [{ type: "text", text }],
  };
}

function messageAt(role: string, text: string, createdAt: string) {
  return {
    info: {
      id: `${role}-${text}`,
      role,
      time: { created: new Date(createdAt).getTime() },
    },
    parts: [{ type: "text", text }],
  };
}
