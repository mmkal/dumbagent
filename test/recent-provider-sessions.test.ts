import { expect, test } from "bun:test";
import { readRecentProviderSessions, type RecentProviderDiagnostic } from "../src/recent-provider-sessions.ts";
import type { RecentAgentSession } from "../src/opencode-sdk.ts";

test("returns an empty provider slice after a discovery timeout", async () => {
  const diagnostics: RecentProviderDiagnostic[] = [];
  const startedAt = Date.now();
  const sessions = await readRecentProviderSessions({
    provider: "claude",
    read: () => new Promise<RecentAgentSession[]>(() => {}),
    timeoutMs: 25,
    unavailableRetryDelayMs: 0,
    isUnavailableStoreError: () => false,
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  expect(sessions).toEqual([]);
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(diagnostics).toMatchObject([{
    provider: "claude",
    kind: "timeout",
    message: "Recent claude session discovery timed out after 25ms.",
  }]);
});

test("retries a transient unavailable store before defaulting to an empty provider slice", async () => {
  const diagnostics: RecentProviderDiagnostic[] = [];
  let calls = 0;
  const sessions = await readRecentProviderSessions({
    provider: "codex",
    read: () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Codex state database not found at /tmp/codex/state_5.sqlite");
      }
      return [recentSession("recovered-codex-thread")];
    },
    timeoutMs: 1_000,
    unavailableRetryDelayMs: 1,
    isUnavailableStoreError: (message) => message.startsWith("Codex state database not found at "),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  expect(calls).toBe(2);
  expect(sessions).toMatchObject([{ id: "recovered-codex-thread" }]);
  expect(diagnostics).toEqual([]);
});

test("reports unavailable stores after the retry is exhausted", async () => {
  const diagnostics: RecentProviderDiagnostic[] = [];
  const sessions = await readRecentProviderSessions({
    provider: "codex",
    read: () => {
      throw new Error("Codex state database not found at /tmp/codex/state_5.sqlite");
    },
    timeoutMs: 1_000,
    unavailableRetryDelayMs: 1,
    isUnavailableStoreError: (message) => message.startsWith("Codex state database not found at "),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  expect(sessions).toEqual([]);
  expect(diagnostics).toMatchObject([{
    provider: "codex",
    kind: "unavailable",
    message: "Codex state database not found at /tmp/codex/state_5.sqlite",
  }]);
});

function recentSession(id: string): RecentAgentSession {
  return {
    provider: "codex",
    id,
    title: "Recovered Codex",
    cwd: "/repo",
    updatedAt: "2026-05-20T08:00:00.000Z",
    lastMessageAt: "2026-05-20T08:00:00.000Z",
    lastMessageText: "Recovered after a retry.",
    initialUserText: "Please recover recents.",
    latestUserText: "Please recover recents.",
    userMessageCount: 1,
    latestAssistantText: "Recovered.",
    messageCount: 2,
    status: "idle",
    archived: false,
    command: "codex",
    args: ["resume", id],
  };
}
