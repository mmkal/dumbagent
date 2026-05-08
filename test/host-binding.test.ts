import { execFileSync, spawn } from "node:child_process";
import * as path from "node:path";
import { once } from "node:events";
import { expect, test } from "bun:test";

test("default server binding exposes a Tailscale URL when Tailscale is available", async () => {
  await using server = await startTuiuiServer();
  const localUrl = server.urls.find((url) => url.startsWith("http://127.0.0.1:")) || "";
  expect(localUrl).not.toBe("");
  await expectHealth(localUrl);

  const tailscaleIps = getTailscaleIps();
  if (tailscaleIps.length > 0) {
    const tailscaleUrl = server.urls.find((url) => url.startsWith(`http://${tailscaleIps[0]}:`)) || "";
    expect(tailscaleUrl).not.toBe("");
    await expectHealth(tailscaleUrl);
  }
});

async function startTuiuiServer() {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const child = spawn("bun", ["run", path.join(rootDir, "cli.ts"), "--port", "0"], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const deadline = Date.now() + 10_000;
  while (!stdout.includes("\n") && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const urls = stdout.trim().split("\n").filter(Boolean);
  if (urls.length === 0) {
    child.kill("SIGTERM");
    throw new Error(`server did not print a URL\nstderr:\n${stderr}`);
  }

  return {
    urls,
    async [Symbol.asyncDispose]() {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ]);
    },
  };
}

async function expectHealth(baseUrl: string) {
  const response = await fetch(`${baseUrl}/health`);
  expect({
    url: baseUrl,
    ok: response.ok,
    body: await response.json(),
  }).toMatchObject({
    url: baseUrl,
    ok: true,
    body: { ok: true },
  });
}

function getTailscaleIps() {
  try {
    return execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}
