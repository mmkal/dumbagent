import { expect, test } from "bun:test";
import { buildOpenCodeSummary, resolveOpenCodeSession } from "../src/opencode-sdk.ts";

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
