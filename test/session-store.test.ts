import { expect, test } from "bun:test";
import { formatCommandLine, parseCommandLine } from "../src/command-line.ts";
import { createSessionStore } from "../src/session-store.ts";

test("records sessions and later attaches a recovery command", () => {
  using store = createSessionStore(":memory:");

  store.recordSession({
    id: "tuiui_store_test",
    cwd: "/tmp/tuiui-store",
    launchCommand: "codex --model gpt-5.4",
    createdAtMs: 1_000,
  });

  expect(store.getSession("tuiui_store_test")).toMatchObject({
    id: "tuiui_store_test",
    cwd: "/tmp/tuiui-store",
    launchCommand: "codex --model gpt-5.4",
    createdAtMs: 1_000,
    recoveryCommand: null,
    recoveryCreatedAtMs: null,
  });

  store.setSessionRecovery({
    sessionId: "tuiui_store_test",
    recoveryCommand: "codex resume thread-123",
    createdAtMs: 2_000,
  });

  expect(store.getSession("tuiui_store_test")).toMatchObject({
    recoveryCommand: "codex resume thread-123",
    recoveryCreatedAtMs: 2_000,
  });
});

test("formats recovery commands so they can be parsed again", () => {
  const commandLine = formatCommandLine("codex", ["resume", "thread with spaces"]);

  expect(commandLine).toBe("codex resume 'thread with spaces'");
  expect(parseCommandLine(commandLine)).toMatchObject({
    command: "codex",
    args: ["resume", "thread with spaces"],
  });
});
