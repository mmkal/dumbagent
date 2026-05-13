import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "bun:test";
import { createSessionStore } from "../src/session-store.ts";

test("recovers a dead non-tmux session from the stored recovery command", async () => {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tuiui-session-recovery-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const binDir = path.join(tempRoot, "bin");
  const stateDb = path.join(tempRoot, "state", "tuiui.sqlite");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "first-agent"), longRunningAgentSource("first ready"), { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "recovered-agent"), longRunningAgentSource("recovered ready"), { mode: 0o755 });

  const port = await getFreePort();
  const env = {
    ...process.env,
    PATH: [binDir, process.env.PATH || ""].join(path.delimiter),
    HOME: path.join(tempRoot, "home"),
    TUIUI_STATE_DB: stateDb,
  };
  let server: ChildProcess | null = await startTuiuiServer(rootDir, workspaceDir, env, port);
  let sessionId = "";

  try {
    const created = await fetchJson<{ id: string }>(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
      body: JSON.stringify({
        command: "first-agent",
        args: [],
        cwd: workspaceDir,
        cols: 80,
        rows: 24,
        env: {},
      }),
    });
    sessionId = created.id;
    await expectSessionText(port, sessionId, "first ready");

    using store = createSessionStore(stateDb);
    store.setSessionRecovery({
      sessionId,
      recoveryCommand: "recovered-agent",
      createdAtMs: Date.now(),
    });

    server.kill("SIGTERM");
    await waitForExit(server);
    server = await startTuiuiServer(rootDir, workspaceDir, env, port);

    const missing = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "Session not found" });
    expect(await fetchJson<any>(`http://127.0.0.1:${port}/api/sessions/${sessionId}/recovery`)).toMatchObject({
      id: sessionId,
      cwd: workspaceDir,
      launchCommand: "first-agent",
      recoveryCommand: "recovered-agent",
      recoverable: true,
    });

    expect(await fetchJson<{ id: string }>(`http://127.0.0.1:${port}/api/sessions/${sessionId}/recover`, {
      method: "POST",
    })).toMatchObject({ id: sessionId });
    await expectSessionText(port, sessionId, "recovered ready");
  } finally {
    if (server) {
      if (sessionId) {
        await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/kill`, { method: "POST" }).catch(() => {});
      }
      server.kill("SIGTERM");
      await waitForExit(server);
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function startTuiuiServer(rootDir: string, cwd: string, env: NodeJS.ProcessEnv, port: number) {
  const server = spawn("bun", ["run", path.join(rootDir, "cli.ts"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  server.stderr.on("data", (chunk: Buffer) => {
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

async function expectSessionText(port: number, sessionId: string, text: string) {
  const payload = await pollSession(port, sessionId, (candidate) => candidate.renderedText.includes(text));
  expect(payload.renderedText).toContain(text);
}

async function pollSession(port: number, sessionId: string, predicate: (payload: any) => boolean) {
  const deadline = Date.now() + 5_000;
  let payload: any = null;
  while (Date.now() < deadline) {
    payload = await fetchJson<any>(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
    if (predicate(payload)) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return payload;
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

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]);
}

function longRunningAgentSource(message: string) {
  return `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(`${message}\r\n`)});
process.stdin.resume();
setInterval(() => {}, 1_000);
`;
}
