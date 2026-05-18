import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

test("codex resume terminates the existing wrapper-owned session before starting the resume", async () => {
  using fixture = createFakeCodexFixture();
  const sessionId = "019e9999-1111-7222-8333-abcdefabcdef";

  const first = spawn(process.execPath, [path.resolve("bin/tuiui.ts"), "codex"], {
    cwd: fixture.workspace,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      FAKE_CODEX_SESSION_ID: sessionId,
      FAKE_CODEX_STARTED_PATH: fixture.firstStartedPath,
      FAKE_CODEX_TERMINATED_PATH: fixture.firstTerminatedPath,
      REALCODEX: fixture.codexPath,
      TUIUI_CODEX_LEASE_DISCOVERY_INTERVAL_MS: "25",
      TUIUI_STATE_DB: fixture.stateDb,
    },
    stdio: "ignore",
  });

  try {
    await waitForFile(fixture.firstStartedPath);
    await waitForLease(fixture.stateDb, sessionId);

    const resumed = spawnSync(process.execPath, [path.resolve("bin/tuiui.ts"), "codex", "resume", sessionId], {
      cwd: fixture.workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: fixture.codexHome,
        FAKE_CODEX_RESUMED_PATH: fixture.resumedPath,
        FAKE_CODEX_TERMINATED_PATH: fixture.firstTerminatedPath,
        REALCODEX: fixture.codexPath,
        TUIUI_CODEX_LEASE_KILL_TIMEOUT_MS: "500",
        TUIUI_STATE_DB: fixture.stateDb,
      },
    });

    expect(resumed).toMatchObject({ status: 0 });
    await waitForFile(fixture.firstTerminatedPath);
    await waitForExit(first);
    expect(JSON.parse(fs.readFileSync(fixture.resumedPath, "utf8"))).toMatchObject({
      args: ["resume", sessionId],
      terminatedBeforeResumeStarted: true,
    });
  } finally {
    killIfRunning(first);
  }
});

test("web UI codex resume refuses to terminate an existing wrapper-owned session", async () => {
  using fixture = createFakeCodexFixture();
  const sessionId = "019e9999-1111-7222-8333-bbbbbbbbbbbb";

  const first = spawn(process.execPath, [path.resolve("bin/tuiui.ts"), "codex"], {
    cwd: fixture.workspace,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      FAKE_CODEX_SESSION_ID: sessionId,
      FAKE_CODEX_STARTED_PATH: fixture.firstStartedPath,
      FAKE_CODEX_TERMINATED_PATH: fixture.firstTerminatedPath,
      REALCODEX: fixture.codexPath,
      TUIUI_CODEX_LEASE_DISCOVERY_INTERVAL_MS: "25",
      TUIUI_STATE_DB: fixture.stateDb,
    },
    stdio: "ignore",
  });
  let server: ChildProcess | null = null;

  try {
    await waitForFile(fixture.firstStartedPath);
    await waitForLease(fixture.stateDb, sessionId);

    const port = await getFreePort();
    server = await startTuiuiServer(fixture.workspace, {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      FAKE_CODEX_RESUMED_PATH: fixture.resumedPath,
      FAKE_CODEX_TERMINATED_PATH: fixture.firstTerminatedPath,
      HOME: path.join(fixture.workspace, "home"),
      PATH: [fixture.binDir, process.env.PATH || ""].join(path.delimiter),
      TUIUI_CODEX_LEASE_KILL_TIMEOUT_MS: "500",
      TUIUI_STATE_DB: fixture.stateDb,
    }, port);

    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "codex",
        args: ["resume", sessionId],
        cwd: fixture.workspace,
        cols: 80,
        rows: 24,
        env: {
          FAKE_CODEX_RESUMED_PATH: fixture.resumedPath,
          FAKE_CODEX_TERMINATED_PATH: fixture.firstTerminatedPath,
        },
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "That Codex session is already active in another terminal. TUI UI will not terminate it from a recent-session card.",
    });
    expect(fs.existsSync(fixture.firstTerminatedPath)).toBe(false);
    expect(fs.existsSync(fixture.resumedPath)).toBe(false);
    expect(first.exitCode).toBe(null);
  } finally {
    killIfRunning(first);
    if (server) {
      server.kill("SIGTERM");
      await waitForExit(server).catch(() => {});
    }
  }
});

test("codex command forwards unknown Codex flags instead of treating them as tuiui options", () => {
  using fixture = createFakeCodexFixture();

  const result = spawnSync(process.execPath, [path.resolve("bin/tuiui.ts"), "codex", "--help", "--yolo"], {
    cwd: fixture.workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_CODEX_RECORD_ARGS_PATH: fixture.recordArgsPath,
      REALCODEX: fixture.codexPath,
      TUIUI_STATE_DB: fixture.stateDb,
    },
  });

  expect(result).toMatchObject({ status: 0 });
  expect(JSON.parse(fs.readFileSync(fixture.recordArgsPath, "utf8"))).toEqual(["--help", "--yolo"]);
});

function createFakeCodexFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tuiui-codex-lease-"));
  const binDir = path.join(root, "bin");
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  const codexPath = path.join(binDir, "codex");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(codexPath, fakeCodexSource, { mode: 0o755 });

  return {
    binDir,
    codexHome,
    codexPath,
    firstStartedPath: path.join(root, "first-started.json"),
    firstTerminatedPath: path.join(root, "first-terminated.json"),
    recordArgsPath: path.join(root, "record-args.json"),
    resumedPath: path.join(root, "resumed.json"),
    stateDb: path.join(root, "tuiui.sqlite"),
    workspace,
    [Symbol.dispose]() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitForLease(stateDb: string, sessionId: string) {
  const lease = await poll(() => {
    if (!fs.existsSync(stateDb)) {
      return null;
    }

    let database: Database | null = null;
    try {
      database = new Database(stateDb);
      database.exec("pragma busy_timeout = 1000;");
      return database.query(`
        select
          session_process_owners.session_id as sessionId,
          session_process_owners.pid,
          session_recovery.recovery_command as recoveryCommand,
          sessions.cwd
        from session_process_owners
        inner join session_recovery on session_recovery.session_id = session_process_owners.session_id
        inner join sessions on sessions.id = session_process_owners.session_id
        where session_process_owners.session_id = ?
        limit 1
      `).get(sessionId) as any;
    } catch (error) {
      if (String(error).includes("SQLITE_BUSY")) {
        return null;
      }
      throw error;
    } finally {
      database?.close();
    }
  });
  expect(lease).toMatchObject({
    cwd: fs.realpathSync(path.join(path.dirname(stateDb), "workspace")),
    recoveryCommand: `codex resume ${sessionId}`,
    sessionId,
  });
}

async function waitForFile(filePath: string) {
  await poll(() => fs.existsSync(filePath));
}

async function waitForExit(child: ChildProcess) {
  await poll(() => child.exitCode !== null || child.signalCode !== null);
}

async function poll<T>(read: () => T) {
  const deadline = Date.now() + 5_000;
  let value = read();
  while (!value && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = read();
  }
  if (!value) {
    throw new Error("Timed out waiting for condition");
  }
  return value;
}

function killIfRunning(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
}

async function startTuiuiServer(cwd: string, env: NodeJS.ProcessEnv, port: number) {
  const server = spawn(process.execPath, ["run", path.resolve(import.meta.dirname, "..", "cli.ts"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  server.stdout?.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return server;
      }
    } catch {
    }
    if (server.exitCode !== null) {
      throw new Error(`server exited early\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  server.kill("SIGTERM");
  throw new Error(`timed out waiting for server\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const fakeCodexSource = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (process.env.FAKE_CODEX_RECORD_ARGS_PATH) {
  fs.writeFileSync(process.env.FAKE_CODEX_RECORD_ARGS_PATH, JSON.stringify(args));
  process.exit(0);
}

if (args[0] === "resume") {
  fs.writeFileSync(process.env.FAKE_CODEX_RESUMED_PATH, JSON.stringify({
    args,
    terminatedBeforeResumeStarted: fs.existsSync(process.env.FAKE_CODEX_TERMINATED_PATH || ""),
  }));
  process.exit(0);
}

const sessionId = process.env.FAKE_CODEX_SESSION_ID;
const sessionDir = path.join(process.env.CODEX_HOME, "sessions", "2026", "05", "14");
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(
  path.join(sessionDir, "rollout-2026-05-14T00-00-00-" + sessionId + ".jsonl"),
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "session_meta",
    payload: {
      id: sessionId,
      cwd: process.cwd(),
      source: "cli",
      originator: "codex-tui",
    },
  }) + "\\n",
);
fs.writeFileSync(process.env.FAKE_CODEX_STARTED_PATH, JSON.stringify({ pid: process.pid }));

process.on("SIGTERM", () => {
  fs.writeFileSync(process.env.FAKE_CODEX_TERMINATED_PATH, JSON.stringify({ signal: "SIGTERM" }));
  process.exit(143);
});

setInterval(() => {}, 1000);
`;
