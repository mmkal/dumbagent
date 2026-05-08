import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test as base, type Page } from "@playwright/test";

type FixtureContext = {
  rootDir: string;
  tempRoot: string;
  workspaceDir: string;
  fakeBinDir: string;
  port: number;
  baseUrl: string;
  server: ChildProcess;
  env: NodeJS.ProcessEnv;
};

const test = base.extend<{ ctx: FixtureContext }>({
  ctx: async ({}, use) => {
    await using ctx = await createContext();
    await use(ctx);
  },
});

test("launches a TUI, translates boxes into semantic sections, and accepts composer input", async ({ page, ctx }) => {
  await page.goto(ctx.baseUrl);

  await page.getByRole("textbox", { name: "Command" }).fill("semantic-agent");
  await expect(page.getByRole("textbox", { name: "Working directory" })).toHaveValue(fs.realpathSync(ctx.workspaceDir));
  await page.getByRole("button", { name: "Launch" }).click();

  await expect(page).toHaveURL(/\/sessions\/tuiui_[a-f0-9]+$/);
  await page.getByRole("button", { name: "HTML" }).click();
  await expect(page.getByTestId("semantic-section").filter({ hasText: "Ask anything" })).toBeVisible();
  await expect(page.getByTestId("semantic-section").filter({ hasText: "semantic-agent" })).toBeVisible();

  await page.getByRole("textbox", { name: "Send stdin" }).fill("what is one plus two");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("semantic-section").filter({ hasText: "three" })).toBeVisible();
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByTestId("sdk-summary")).toContainText("No SDK adapter");
  await page.getByRole("button", { name: "TTY" }).click();
  await expect(page.getByTestId("rendered-terminal")).toContainText("three");

  await page.getByRole("button", { name: "Logs" }).click();
  await expect(page.getByTestId("stdin-log")).toContainText("what is one plus two");
  await expect(page.getByTestId("stdout-log")).toContainText("three");
});

test("sends named key chords separately from the composer", async ({ page, ctx }) => {
  await page.goto(ctx.baseUrl);

  await page.getByRole("textbox", { name: "Command" }).fill("semantic-agent");
  await page.getByRole("button", { name: "Launch" }).click();
  await page.getByRole("button", { name: "HTML" }).click();
  await expect(page.getByTestId("semantic-section").filter({ hasText: "Ask anything" })).toBeVisible();

  await page.getByRole("button", { name: "esc" }).click();

  await expect(page.getByTestId("semantic-section").filter({ hasText: "key escape" })).toBeVisible();
});

test("keeps split utf-8 output intact", async ({ page, ctx }) => {
  await page.goto(ctx.baseUrl);

  await page.getByRole("textbox", { name: "Command" }).fill("bytewise-ui");
  await page.getByRole("button", { name: "Launch" }).click();

  await expect(page.getByTestId("semantic-screen")).toContainText("──hello──");
  await expect(page.getByTestId("semantic-screen")).not.toContainText("\uFFFD");
});

test("can drive OpenCode through fakeagent when OpenCode is installed", async ({ page, ctx }) => {
  test.skip(!commandExists("opencode"), "opencode is not installed");

  await page.goto(ctx.baseUrl);
  await page.getByRole("combobox", { name: "Preset" }).selectOption("fake-opencode");
  await page.getByRole("button", { name: "Launch" }).click();

  await expect(page.getByTestId("rendered-terminal")).toContainText(/Ask anything|OpenCode/i);

  await page.getByRole("textbox", { name: "Send stdin" }).fill("what is one plus two");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("rendered-terminal")).toContainText("three", { timeout: 20_000 });
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByRole("button", { name: "Refresh SDK" }).click();
  await expect(page.getByTestId("sdk-summary")).toContainText("connected");
  await expect(page.getByRole("textbox", { name: "SDK data YAML" })).toContainText("latestUserText: what is one plus two");
  await expect(page.locator("#sdk-yaml-editor .cm-line span[class]").first()).toBeVisible();
  expect(await measureFirstLineGutterOffset(page)).toBeLessThanOrEqual(1);
  const refreshedPayload = await fetchSessionPayload(page);
  expect(refreshedPayload.sdk.summary.latestAssistantText).toContain("three");
  await page.getByRole("button", { name: "Summarize via SDK" }).click();
  await expect(page.getByRole("textbox", { name: "SDK data YAML" })).toContainText("method: opencode.session.fork+summarize", { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "SDK data YAML" })).toContainText("status: completed");
  await expect(page.getByRole("textbox", { name: "SDK data YAML" })).toContainText("forks:");
  await expect(page.getByRole("textbox", { name: "SDK data YAML" })).toContainText("forkSessionId:");
  const payload = await fetchSessionPayload(page);
  expect(payload.sdk.forks[0]).toMatchObject({
    provider: "opencode",
    purpose: "sidecarSummary",
    sourceSessionId: payload.sdk.externalSessionId,
    status: "summarized",
    result: true,
  });
  expect(payload.sdk.forks[0].forkSessionId).not.toBe(payload.sdk.externalSessionId);
  expect(payload.sdk.summary).toMatchObject({ messageCount: 2 });
  const yamlBeforeRefresh = await page.locator("#sdk-yaml-editor .cm-content").textContent();
  const scrollBeforeRefresh = await scrollYamlEditorToBottom(page);
  expect(scrollBeforeRefresh).toBeGreaterThan(0);
  await markYamlEditorContent(page);
  await page.getByRole("button", { name: "Refresh SDK" }).click();
  await expect.poll(async () => await page.locator("#sdk-yaml-editor .cm-content").textContent()).not.toBe(yamlBeforeRefresh);
  expect(await isYamlEditorContentMarked(page)).toBe(true);
  expect(await getYamlEditorScrollTop(page)).toBeGreaterThanOrEqual(scrollBeforeRefresh - 1);
  await expect(page.locator("#sdk-yaml-editor .cm-foldGutter span[title='Fold line']").first()).toBeVisible();
  await expect(page.locator("#sdk-yaml-editor .cm-editor.cm-lineWrapping")).toHaveCount(0);
});

async function fetchSessionPayload(page: Page) {
  return await page.evaluate(async () => {
    const id = location.pathname.split("/").at(-1);
    return await fetch(`/api/sessions/${id}`).then((response) => response.json());
  });
}

async function measureFirstLineGutterOffset(page: Page) {
  return await page.locator("#sdk-yaml-editor").evaluate((editor) => {
    const line = editor.querySelector(".cm-line");
    const lineNumber = [...editor.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
      .find((element) => element.textContent?.trim() === "1");
    if (!line || !lineNumber) {
      return 999;
    }
    const lineBox = line.getBoundingClientRect();
    const gutterBox = lineNumber.getBoundingClientRect();
    const lineCenter = lineBox.top + lineBox.height / 2;
    const gutterCenter = gutterBox.top + gutterBox.height / 2;
    return Math.abs(lineCenter - gutterCenter);
  });
}

async function scrollYamlEditorToBottom(page: Page) {
  return await page.locator("#sdk-yaml-editor .cm-scroller").evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight;
    return scroller.scrollTop;
  });
}

async function getYamlEditorScrollTop(page: Page) {
  return await page.locator("#sdk-yaml-editor .cm-scroller").evaluate((scroller) => scroller.scrollTop);
}

async function markYamlEditorContent(page: Page) {
  await page.locator("#sdk-yaml-editor").evaluate((editor) => {
    (editor.querySelector(".cm-content") as any).__tuiuiStillMounted = true;
  });
}

async function isYamlEditorContentMarked(page: Page) {
  return await page.locator("#sdk-yaml-editor").evaluate((editor) => {
    return Boolean((editor.querySelector(".cm-content") as any).__tuiuiStillMounted);
  });
}

async function createContext() {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tuiui-spec-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const fakeBinDir = path.join(tempRoot, "bin");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(path.join(fakeBinDir, "semantic-agent"), semanticAgentSource, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBinDir, "bytewise-ui"), bytewiseUiSource, { mode: 0o755 });

  const port = await getFreePort();
  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH || ""}`,
    HOME: path.join(tempRoot, "home"),
  };
  const server = spawn("bun", ["run", path.join(rootDir, "cli.ts"), "--port", String(port)], {
    cwd: workspaceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServer(server, port);

  return {
    rootDir,
    tempRoot,
    workspaceDir,
    fakeBinDir,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    env,
    async [Symbol.asyncDispose]() {
      server.kill("SIGTERM");
      await Promise.race([
        once(server, "exit"),
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ]);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

async function waitForServer(server: ChildProcess, port: number) {
  let stdout = "";
  let stderr = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
    }
    if (server.exitCode !== null) {
      throw new Error(`server exited early\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for server\nstdout:\n${stdout}\nstderr:\n${stderr}`);
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

function commandExists(command: string) {
  const paths = (process.env.PATH || "").split(path.delimiter);
  return paths.some((dir) => fs.existsSync(path.join(dir, command)));
}

const semanticAgentSource = `#!/usr/bin/env node
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

let input = "";
let answer = "";
let key = "";

function draw() {
  process.stdout.write("\\x1b[2J\\x1b[H");
  process.stdout.write("╭─ semantic-agent ─────────────╮\\r\\n");
  process.stdout.write("│ status idle                  │\\r\\n");
  process.stdout.write("╰──────────────────────────────╯\\r\\n");
  process.stdout.write("\\r\\n");
  process.stdout.write("╭─ Ask anything ───────────────╮\\r\\n");
  process.stdout.write(("│ " + (input || " ") + "                              │").slice(0, 32) + "│\\r\\n");
  process.stdout.write("╰──────────────────────────────╯\\r\\n");
  if (answer) {
    process.stdout.write("\\r\\n╭─ Answer ─────────────────────╮\\r\\n");
    process.stdout.write(("│ " + answer + "                              │").slice(0, 32) + "│\\r\\n");
    process.stdout.write("╰──────────────────────────────╯\\r\\n");
  }
  if (key) {
    process.stdout.write("\\r\\n╭─ Key ────────────────────────╮\\r\\n");
    process.stdout.write(("│ " + key + "                              │").slice(0, 32) + "│\\r\\n");
    process.stdout.write("╰──────────────────────────────╯\\r\\n");
  }
}

function submit() {
  answer = /one plus two/i.test(input) ? "three" : "heard " + input;
  input = "";
  draw();
}

draw();

process.stdin.on("data", (chunk) => {
  for (const char of chunk) {
    if (char === "\\u0003") process.exit(0);
    if (char === "\\u001b") {
      key = "key escape";
      draw();
      continue;
    }
    if (char === "\\r" || char === "\\n") {
      submit();
      continue;
    }
    input += char;
  }
  draw();
});
`;

const bytewiseUiSource = `#!/usr/bin/env node
const bytes = Buffer.from("──hello──\\n", "utf8");
let index = 0;

function tick() {
  if (index >= bytes.length) return;
  process.stdout.write(Buffer.from([bytes[index]]));
  index += 1;
  setTimeout(tick, 5);
}

tick();
setTimeout(() => {}, 100000);
`;
