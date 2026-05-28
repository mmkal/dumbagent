import type { AgentProvider, RecentAgentSession } from "./opencode-sdk.ts";

export type RecentProviderDiagnostic = {
  provider: AgentProvider;
  kind: "timeout" | "unavailable";
  message: string;
};

export type ReadRecentProviderSessionsInput = {
  provider: AgentProvider;
  read: () => RecentAgentSession[] | Promise<RecentAgentSession[]>;
  timeoutMs: number;
  unavailableRetryDelayMs: number;
  isUnavailableStoreError: (message: string) => boolean;
  reportDiagnostic: (diagnostic: RecentProviderDiagnostic) => void;
};

export async function readRecentProviderSessions(input: ReadRecentProviderSessionsInput) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(
        Promise.resolve().then(input.read),
        input.provider,
        input.timeoutMs,
      );
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (error instanceof RecentProviderTimeoutError) {
        input.reportDiagnostic({ provider: input.provider, kind: "timeout", message });
        return [];
      }
      if (!input.isUnavailableStoreError(message)) {
        throw error;
      }
      if (attempt < maxAttempts && input.unavailableRetryDelayMs > 0) {
        await delay(input.unavailableRetryDelayMs);
        continue;
      }
      input.reportDiagnostic({ provider: input.provider, kind: "unavailable", message });
      return [];
    }
  }
  return [];
}

class RecentProviderTimeoutError extends Error {
  constructor(provider: AgentProvider, timeoutMs: number) {
    super(`Recent ${provider} session discovery timed out after ${timeoutMs}ms.`);
  }
}

async function withTimeout<T>(promise: Promise<T>, provider: AgentProvider, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new RecentProviderTimeoutError(provider, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
