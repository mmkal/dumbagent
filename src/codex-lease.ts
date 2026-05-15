#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { formatCommandLine } from "./command-line.ts";
import { createSessionStoreForEnv, type SessionStore, type StoredSessionProcessOwner } from "./session-store.ts";

type SessionDiscovery = {
  id: string;
  mtimeMs: number;
};

export async function runCodexLease(args: string[]) {
  const realCodex = findRealCodex();
  if (!realCodex) {
    console.error("codex-lease: could not find the real codex binary. Set REALCODEX or CODEX_LEASE_CODEX_BIN.");
    return 127;
  }

  const resumeId = findResumeId(args);
  {
    using store = createSessionStoreForEnv(process.env);
    if (resumeId) {
      await terminateOwnersForRecoveryCommand(store, formatCommandLine("codex", args));
    } else {
      cleanupStaleOwners(store);
    }
  }

  return runRealCodex(realCodex, args, resumeId);
}

function findRealCodex() {
  const configured = process.env.REALCODEX || process.env.CODEX_LEASE_CODEX_BIN;
  if (configured) {
    return configured;
  }

  const found = spawnSync("sh", ["-c", "command -v codex"], { encoding: "utf8" });
  if (found.status !== 0) {
    return "";
  }

  return found.stdout.trim();
}

async function runRealCodex(realCodex: string, args: string[], knownSessionId: string) {
  const startedAtMs = Date.now();
  const launchCommand = formatCommandLine("codex", args);
  const child = spawn(realCodex, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const childPid = child.pid || 0;

  if (knownSessionId) {
    recordRecoverableSessionOwner({
      command: launchCommand,
      pid: childPid,
      sessionId: knownSessionId,
      startedAtMs,
      updatedAtMs: Date.now(),
    });
  }

  let discovery = Promise.resolve("");
  if (knownSessionId) {
    discovery = Promise.resolve(knownSessionId);
  } else if (childPid) {
    discovery = discoverSessionIdForChild({
      childPid,
      cwd: process.cwd(),
      startedAtMs,
    }).then((sessionId) => {
      if (sessionId) {
        recordRecoverableSessionOwner({
          command: launchCommand,
          pid: childPid,
          sessionId,
          startedAtMs,
          updatedAtMs: Date.now(),
        });
      }
      return sessionId;
    });
  }

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", (error) => {
      console.error(error);
      resolve({ code: 127, signal: null });
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  const sessionId = await discovery;
  if (sessionId) {
    using store = createSessionStoreForEnv(process.env);
    removeSessionProcessOwner(store, sessionId, childPid);
  }

  if (result.signal) {
    return 128 + signalNumber(result.signal);
  }
  return result.code || 0;
}

function findResumeId(args: string[]) {
  const index = args.indexOf("resume");
  if (index === -1) {
    return "";
  }

  const candidate = args[index + 1] || "";
  if (!candidate || candidate.startsWith("-")) {
    return "";
  }

  return candidate;
}

export async function terminateOwnersForRecoveryCommand(store: SessionStore, recoveryCommand: string) {
  cleanupStaleOwners(store);
  const owners = store.getSessionProcessOwnersForRecoveryCommand(recoveryCommand);

  for (const owner of owners) {
    await terminateOwner(store, owner);
  }
}

async function terminateOwner(store: SessionStore, owner: StoredSessionProcessOwner) {
  const timeoutMs = Number(process.env.TUIUI_CODEX_LEASE_KILL_TIMEOUT_MS || 2_000);
  try {
    process.kill(owner.pid, "SIGTERM");
  } catch {
    removeSessionProcessOwner(store, owner.sessionId, owner.pid);
    return;
  }

  const stopped = await waitForPidExit(owner.pid, timeoutMs);
  if (!stopped) {
    try {
      process.kill(owner.pid, "SIGKILL");
    } catch {
    }
    await waitForPidExit(owner.pid, 1_000);
  }

  removeSessionProcessOwner(store, owner.sessionId, owner.pid);
}

export function cleanupStaleOwners(store: SessionStore) {
  for (const owner of store.getSessionProcessOwners()) {
    if (!isProcessAlive(owner.pid)) {
      removeSessionProcessOwner(store, owner.sessionId, owner.pid);
    }
  }
}

function recordRecoverableSessionOwner(input: {
  command: string;
  pid: number;
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
}) {
  if (!input.pid) {
    return;
  }

  const recoveryCommand = formatCommandLine("codex", ["resume", input.sessionId]);
  using store = createSessionStoreForEnv(process.env);
  store.recordSession({
    id: input.sessionId,
    cwd: process.cwd(),
    launchCommand: input.command,
    createdAtMs: input.startedAtMs,
  });
  store.setSessionRecovery({
    sessionId: input.sessionId,
    recoveryCommand,
    createdAtMs: input.startedAtMs,
  });
  store.recordSessionProcessOwner({
    sessionId: input.sessionId,
    pid: input.pid,
    createdAtMs: input.startedAtMs,
    updatedAtMs: input.updatedAtMs,
  });
}

function removeSessionProcessOwner(store: SessionStore, sessionId: string, pid: number) {
  store.removeSessionProcessOwner({ sessionId, pid });
}

async function discoverSessionIdForChild(params: { childPid: number; cwd: string; startedAtMs: number }) {
  const attempts = Number(process.env.TUIUI_CODEX_LEASE_DISCOVERY_ATTEMPTS || 100);
  const intervalMs = Number(process.env.TUIUI_CODEX_LEASE_DISCOVERY_INTERVAL_MS || 100);

  for (let i = 0; i < attempts; i += 1) {
    const session = findNewestSessionForCwd(params.cwd, params.startedAtMs);
    if (session) {
      return session.id;
    }

    if (params.childPid && !isProcessAlive(params.childPid)) {
      return findNewestSessionForCwd(params.cwd, params.startedAtMs)?.id || "";
    }

    await delay(intervalMs);
  }

  return "";
}

function findNewestSessionForCwd(cwd: string, startedAtMs: number) {
  const sessionsDir = path.join(codexHome(), "sessions");
  const candidates: SessionDiscovery[] = [];
  collectSessionFiles(sessionsDir, candidates, cwd, startedAtMs);
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0] || null;
}

function collectSessionFiles(dir: string, candidates: SessionDiscovery[], cwd: string, startedAtMs: number) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSessionFiles(entryPath, candidates, cwd, startedAtMs);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const stat = fs.statSync(entryPath);
    if (stat.mtimeMs < startedAtMs - 5_000) {
      continue;
    }

    const session = readSessionMeta(entryPath);
    if (session && session.cwd === cwd) {
      candidates.push({ id: session.id, mtimeMs: stat.mtimeMs });
    }
  }
}

function readSessionMeta(filePath: string) {
  const firstLine = fs.readFileSync(filePath, "utf8").split("\n")[0] || "";
  if (!firstLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(firstLine) as any;
    const payload = parsed.payload;
    if (parsed.type === "session_meta" && typeof payload?.id === "string" && typeof payload?.cwd === "string") {
      return { id: payload.id, cwd: payload.cwd };
    }
  } catch {
  }

  const id = entryPathSessionId(filePath);
  return id ? { id, cwd: "" } : null;
}

function entryPathSessionId(filePath: string) {
  const match = path.basename(filePath).match(/([0-9a-fA-F-]{36})\.jsonl$/);
  return match ? match[1] : "";
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function isProcessAlive(pid: number) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(25);
  }
  return !isProcessAlive(pid);
}

function signalNumber(signal: NodeJS.Signals) {
  const signals: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGABRT: 6,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return signals[signal] || 1;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
