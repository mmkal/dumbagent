import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { foldGutter } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { stringify as stringifyYaml } from "yaml";

type SessionPayload = {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  lifecycle: "running" | "exited";
  status: "busy" | "idle" | "exited";
  exitCode: number | null;
  cols: number;
  rows: number;
  renderedText: string;
  renderedHtml: string;
  blocks: TerminalBlockModel;
  semantic: SemanticScreen;
  sdk: SessionSdkPayload;
  stdinEvents: Array<{ id: number; text: string; createdAt: string }>;
  stdoutEvents: Array<{ id: number; displayText: string; createdAt: string }>;
};

type SessionSdkPayload = {
  provider: "" | "opencode";
  state: "unavailable" | "ready" | "connected" | "not-found" | "error";
  baseUrl: string;
  externalSessionId: string;
  status: string;
  updatedAt: string;
  error: string;
  sidecarSummary: SidecarSummaryState;
  summary: null | {
    provider: "opencode";
    title: string;
    messageCount: number;
    diffCount: number;
    additions: number;
    deletions: number;
    latestUserText: string;
    latestAssistantText: string;
    transcript: Array<{ id: string; role: string; createdAt: string; text: string }>;
    diffs: Array<{ file: string; additions: number; deletions: number }>;
  };
};

type SidecarSummaryState = {
  implemented: boolean;
  status: "idle" | "running" | "completed" | "error";
  method: "" | "opencode.session.summarize";
  providerSessionId: string;
  updatedAt: string;
  result: boolean | null;
  error: string;
  note: string;
};

type SemanticScreen = {
  title: string;
  status: string;
  prompt: string;
  rawText: string;
  sections: SemanticSection[];
};

type SemanticSection = {
  id: string;
  kind: string;
  title: string;
  text: string;
  lines: string[];
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
};

type TerminalBlockModel = {
  coordinateSystem: {
    origin: "top-left";
    x1: "exclusive";
    y1: "exclusive";
  };
  cols: number;
  rows: number;
  cursor: { x: number; y: number; visible: boolean };
  rawText: string;
  blocks: TerminalBlock[];
};

type TerminalBlock = {
  id: string;
  kind: string;
  bounds: { x0: number; y0: number; x1: number; y1: number; width: number; height: number };
  text: string;
  lines: string[];
  border: null | { style: string; title: string };
  colors: { foregrounds: string[]; backgrounds: string[]; flags: string[] };
  confidence: number;
};

type CommandPreset = {
  id: string;
  label: string;
  command: string;
  args: string[];
  fakeAgent: string;
};

const app = document.getElementById("app")!;
let events: EventSource | null = null;
let activeSession: SessionPayload | null = null;
let renderer = readRendererPreference();
let dataEditorView: EditorView | null = null;

void renderRoute();

window.addEventListener("popstate", () => {
  void renderRoute();
});

async function renderRoute() {
  events?.close();
  events = null;
  activeSession = null;
  destroyDataEditor();

  const sessionMatch = location.pathname.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    try {
      await renderSession(sessionMatch[1]!);
    } catch (error) {
      renderMissingSession(String(error instanceof Error ? error.message : error));
    }
    return;
  }

  await renderHome();
}

function renderMissingSession(message: string) {
  destroyDataEditor();
  app.innerHTML = `
    <main class="layout home-layout">
      <header class="topbar">
        <a class="brand" href="/">TUI UI</a>
        <span class="muted">session unavailable</span>
      </header>
      <section class="launcher missing-session" aria-label="Missing session">
        <strong>Session not found</strong>
        <p>${escapeHtml(message)}</p>
        <a href="/">Launch a new session</a>
      </section>
    </main>
  `;
}

function readRendererPreference() {
  const saved = localStorage.getItem("tuiui-renderer") || "";
  return ["terminal", "sdk", "semantic"].includes(saved) ? saved : "terminal";
}

async function renderHome() {
  const [cwd, sessions, commands] = await Promise.all([
    api<{ cwd: string }>("/api/cwd"),
    api<any[]>("/api/sessions"),
    api<CommandPreset[]>("/api/commands"),
  ]);

  app.innerHTML = `
    <main class="layout home-layout">
      <header class="topbar">
        <a class="brand" href="/">TUI UI</a>
        <span class="muted" data-testid="session-count">${sessions.length} sessions</span>
      </header>
      <section class="launcher" aria-label="Launch session">
        <form id="launch-form" class="launch-form">
          <label>
            <span>Preset</span>
            <select name="preset" aria-label="Preset">
              ${commands.map((command) => `<option value="${escapeAttr(command.id)}">${escapeHtml(command.label)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Command</span>
            <input name="command" aria-label="Command" autocomplete="off" required />
          </label>
          <label>
            <span>Args</span>
            <input name="args" aria-label="Arguments" autocomplete="off" />
          </label>
          <label class="wide">
            <span>Working directory</span>
            <input name="cwd" aria-label="Working directory" autocomplete="off" required value="${escapeAttr(cwd.cwd)}" />
          </label>
          <label>
            <span>Columns</span>
            <input name="cols" aria-label="Columns" type="number" min="60" max="220" value="120" required />
          </label>
          <button type="submit">Launch</button>
        </form>
      </section>
      <section class="sessions" aria-label="Sessions">
        ${sessions.length ? sessions.map(renderSessionLink).join("") : `<p class="empty">No sessions</p>`}
      </section>
    </main>
  `;

  const form = document.getElementById("launch-form") as HTMLFormElement;
  const presetInput = form.elements.namedItem("preset") as HTMLSelectElement;
  const commandInput = form.elements.namedItem("command") as HTMLInputElement;
  const argsInput = form.elements.namedItem("args") as HTMLInputElement;
  const presets = new Map(commands.map((command) => [command.id, command]));

  function applyPreset() {
    const preset = presets.get(presetInput.value);
    if (!preset || preset.id === "custom") {
      return;
    }
    commandInput.value = preset.command;
    argsInput.value = preset.args.join(" ");
    form.dataset.fakeAgent = preset.fakeAgent;
  }

  presetInput.addEventListener("change", applyPreset);
  applyPreset();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const preset = presets.get(String(data.get("preset") || ""));
    const result = await api<{ id: string; url: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        command: String(data.get("command") || ""),
        args: parseArgs(String(data.get("args") || "")),
        cwd: String(data.get("cwd") || ""),
        cols: Number(data.get("cols") || 120),
        rows: 42,
        env: {},
        fakeAgent: preset?.fakeAgent || "",
      }),
    });
    history.pushState({}, "", `/sessions/${result.id}`);
    await renderRoute();
  });
}

async function renderSession(sessionId: string) {
  const payload = await api<SessionPayload>(`/api/sessions/${sessionId}`);
  activeSession = payload;

  app.innerHTML = `
    <main class="layout session-layout">
      <header class="topbar">
        <a class="brand" href="/">TUI UI</a>
        <span class="status-pill" data-state="${payload.status}" data-testid="session-status">${payload.status}</span>
        <code class="command" title="${escapeAttr([payload.command, ...payload.args].join(" "))}" data-testid="session-command">${escapeHtml(payload.title || payload.command)}</code>
        <span class="muted cwd">${escapeHtml(payload.cwd)}</span>
        <div class="toolbar" role="group" aria-label="Renderer">
          <button type="button" class="icon-button" data-renderer="terminal" aria-pressed="${renderer === "terminal"}">TTY</button>
          <button type="button" class="icon-button" data-renderer="sdk" aria-pressed="${renderer === "sdk"}">Summary</button>
          <button type="button" class="icon-button" data-renderer="semantic" aria-pressed="${renderer === "semantic"}">HTML</button>
          <button type="button" class="icon-button" data-action="logs" aria-expanded="false">Logs</button>
          <button type="button" class="icon-button danger" data-action="kill">Stop</button>
        </div>
      </header>
      <section class="main-surface">
        <section id="screen" class="screen" data-testid="semantic-screen"></section>
        <aside id="logs" class="logs" hidden>
          <section>
            <h2>stdin</h2>
            <pre data-testid="stdin-log"></pre>
          </section>
          <section>
            <h2>stdout</h2>
            <pre data-testid="stdout-log"></pre>
          </section>
        </aside>
      </section>
      <section class="composer" aria-label="Session input">
        <textarea id="stdin" aria-label="Send stdin" rows="3" spellcheck="false"></textarea>
        <div class="composer-actions">
          <div class="keys" role="group" aria-label="Keys">
            ${renderKeyButton("esc", "Esc")}
            ${renderKeyButton("tab", "Tab")}
            ${renderKeyButton("up", "↑")}
            ${renderKeyButton("down", "↓")}
            ${renderKeyButton("left", "←")}
            ${renderKeyButton("right", "→")}
            ${renderKeyButton("ctrl+c", "^C")}
          </div>
          <button type="button" id="send">Send</button>
        </div>
      </section>
    </main>
  `;

  bindSessionControls(sessionId);
  renderSessionPayload(payload);
  subscribe(sessionId);
}

function bindSessionControls(sessionId: string) {
  const textarea = document.getElementById("stdin") as HTMLTextAreaElement;
  const sendButton = document.getElementById("send") as HTMLButtonElement;

  sendButton.addEventListener("click", () => {
    void sendComposer(sessionId);
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void sendComposer(sessionId);
      return;
    }

    if (textarea.value || textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) {
      return;
    }

    const key = keyNameFromKeyboardEvent(event);
    if (!key) {
      return;
    }
    event.preventDefault();
    void sendKey(sessionId, key);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      void sendKey(sessionId, button.dataset.key || "");
      textarea.focus();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-renderer]").forEach((button) => {
    button.addEventListener("click", () => {
      renderer = button.dataset.renderer || "semantic";
      localStorage.setItem("tuiui-renderer", renderer);
      renderSessionPayload(activeSession);
    });
  });

  document.querySelector<HTMLButtonElement>("[data-action='logs']")?.addEventListener("click", (event) => {
    const logs = document.getElementById("logs")!;
    logs.hidden = !logs.hidden;
    (event.currentTarget as HTMLButtonElement).setAttribute("aria-expanded", String(!logs.hidden));
  });

  document.querySelector<HTMLButtonElement>("[data-action='kill']")?.addEventListener("click", () => {
    void api(`/api/sessions/${sessionId}/kill`, { method: "POST" });
  });
}

async function sendComposer(sessionId: string) {
  const textarea = document.getElementById("stdin") as HTMLTextAreaElement;
  const text = textarea.value;
  textarea.value = "";
  await api(`/api/sessions/${sessionId}/send`, {
    method: "POST",
    body: JSON.stringify({ text, submit: true }),
  });
}

async function sendKey(sessionId: string, key: string) {
  await api(`/api/sessions/${sessionId}/key`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

function subscribe(sessionId: string) {
  events?.close();
  events = new EventSource(`/api/sessions/${sessionId}/events`);
  events.addEventListener("session", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as SessionPayload;
    renderSessionPayload(payload);
  });
}

function renderSessionPayload(payload: SessionPayload | null) {
  if (!payload) {
    return;
  }
  activeSession = payload;
  document.title = `${payload.title || payload.command} · TUI UI`;

  const status = document.querySelector<HTMLElement>("[data-testid='session-status']");
  if (status) {
    status.textContent = payload.status;
    status.dataset.state = payload.status;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-renderer]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.renderer === renderer));
  });

  const screen = document.getElementById("screen")!;
  if (renderer === "terminal") {
    destroyDataEditor();
    screen.className = "screen terminal-screen";
    screen.innerHTML = `<div class="terminal-html" data-testid="rendered-terminal">${payload.renderedHtml || `<pre>${escapeHtml(payload.renderedText)}</pre>`}</div>`;
  } else if (renderer === "sdk") {
    renderSdkScreen(screen, payload);
  } else {
    destroyDataEditor();
    screen.className = "screen semantic-screen";
    screen.innerHTML = renderSemanticScreen(payload.semantic);
  }

  const stdinLog = document.querySelector<HTMLElement>("[data-testid='stdin-log']");
  if (stdinLog) {
    stdinLog.textContent = payload.stdinEvents.map((event) => `[${formatTime(event.createdAt)}] ${event.text}`).join("\n");
  }
  const stdoutLog = document.querySelector<HTMLElement>("[data-testid='stdout-log']");
  if (stdoutLog) {
    stdoutLog.textContent = payload.stdoutEvents.map((event) => event.displayText ? `[${formatTime(event.createdAt)}] ${event.displayText}` : "").filter(Boolean).join("\n\n");
  }
}

function renderSdkScreen(screen: HTMLElement, payload: SessionPayload) {
  destroyDataEditor();
  screen.className = "screen sdk-screen";

  const sdk = payload.sdk;
  if (!sdk.provider) {
    screen.innerHTML = `
      <section class="sdk-panel unavailable" data-testid="sdk-summary">
        <header>
          <strong>No SDK adapter</strong>
          <span>This session is only available through the terminal stream.</span>
        </header>
      </section>
    `;
    return;
  }

  screen.innerHTML = `
    <section class="sdk-panel" data-testid="sdk-summary">
      <header>
        <div>
          <strong>${escapeHtml(sdk.provider)} SDK</strong>
          <span>${escapeHtml(sdk.baseUrl || "")}</span>
        </div>
        <span class="sdk-state" data-state="${escapeAttr(sdk.state)}">${escapeHtml(sdk.state)}</span>
        <button type="button" class="secondary-button" data-action="sdk-refresh">Refresh SDK</button>
        <button type="button" class="secondary-button" data-action="sdk-summarize" ${sdk.sidecarSummary.status === "running" ? "disabled" : ""}>Summarize via SDK</button>
      </header>
      ${sdk.error ? `<p class="sdk-error">${escapeHtml(sdk.error)}</p>` : ""}
      <section class="sdk-yaml-panel" aria-label="SDK data YAML panel">
        <div id="sdk-yaml-editor" data-testid="sdk-yaml"></div>
      </section>
    </section>
  `;

  screen.querySelector<HTMLButtonElement>("[data-action='sdk-refresh']")?.addEventListener("click", () => {
    void refreshSdk(payload.id);
  });
  screen.querySelector<HTMLButtonElement>("[data-action='sdk-summarize']")?.addEventListener("click", () => {
    void summarizeSdk(payload.id);
  });
  mountYamlEditor("sdk-yaml-editor", stringifyYaml(buildSdkYamlData(payload), null, { lineWidth: 0 }));
}

function buildSdkYamlData(payload: SessionPayload) {
  return {
    tuiui: {
      sessionId: payload.id,
      title: payload.title,
      command: [payload.command, ...payload.args].join(" "),
      cwd: payload.cwd,
      lifecycle: payload.lifecycle,
      status: payload.status,
      exitCode: payload.exitCode,
    },
    sdk: {
      provider: payload.sdk.provider || null,
      state: payload.sdk.state,
      baseUrl: payload.sdk.baseUrl || null,
      providerSessionId: payload.sdk.externalSessionId || null,
      providerStatus: payload.sdk.status || null,
      updatedAt: payload.sdk.updatedAt || null,
      error: payload.sdk.error || null,
    },
    sidecarSummary: payload.sdk.sidecarSummary,
    providerData: payload.sdk.summary ? {
      title: payload.sdk.summary.title,
      messageCount: payload.sdk.summary.messageCount,
      diffCount: payload.sdk.summary.diffCount,
      additions: payload.sdk.summary.additions,
      deletions: payload.sdk.summary.deletions,
      latestUserText: payload.sdk.summary.latestUserText,
      latestAssistantText: payload.sdk.summary.latestAssistantText,
      transcript: payload.sdk.summary.transcript,
      diffs: payload.sdk.summary.diffs,
    } : null,
  };
}

function mountYamlEditor(hostId: string, doc: string) {
  const host = document.getElementById(hostId);
  if (!host) {
    return;
  }
  dataEditorView = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        yaml(),
        lineNumbers(),
        foldGutter(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": "SDK data YAML" }),
        editorTheme(),
      ],
    }),
  });
}

async function refreshSdk(sessionId: string) {
  const payload = await api<SessionPayload>(`/api/sessions/${sessionId}/sdk-refresh`, { method: "POST" });
  renderSessionPayload(payload);
}

async function summarizeSdk(sessionId: string) {
  const payload = await api<SessionPayload>(`/api/sessions/${sessionId}/sdk-summarize`, { method: "POST" });
  renderSessionPayload(payload);
}

function renderBlocksScreen(screen: HTMLElement, model: TerminalBlockModel) {
  destroyDataEditor();
  screen.className = "screen blocks-screen";
  screen.innerHTML = `
    <div class="blocks-layout">
      <section class="blocks-summary" aria-label="Parsed blocks summary">
        <header>
          <strong>${model.blocks.length} blocks</strong>
          <span>${model.cols}x${model.rows} · cursor ${model.cursor.x},${model.cursor.y}</span>
        </header>
        <div class="blocks-list">
          ${model.blocks.map((block) => `
            <article class="block-row" data-kind="${escapeAttr(block.kind)}" data-testid="block-row">
              <strong>${escapeHtml(block.id)}</strong>
              <span>${escapeHtml(block.kind)}</span>
              <code>${block.bounds.x0},${block.bounds.y0} → ${block.bounds.x1},${block.bounds.y1}</code>
              <p>${escapeHtml(block.border?.title || firstLine(block.text) || "(empty)")}</p>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="blocks-json-panel" aria-label="Parsed blocks JSON panel">
        <div id="blocks-json-editor" data-testid="blocks-json"></div>
      </section>
    </div>
  `;

  const host = document.getElementById("blocks-json-editor");
  if (!host) {
    return;
  }
  dataEditorView = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: JSON.stringify(model, null, 2),
      extensions: [
        json(),
        lineNumbers(),
        foldGutter(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": "Parsed blocks JSON" }),
        editorTheme(),
      ],
    }),
  });
}

function editorTheme() {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "#0d1014",
      color: "#eef2f7",
      fontSize: "12px",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    ".cm-gutters": {
      backgroundColor: "#11161d",
      color: "#748293",
      borderRightColor: "#2c333d",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#18202a",
    },
    ".cm-activeLine": {
      backgroundColor: "#151d26",
    },
  });
}

function destroyDataEditor() {
  dataEditorView?.destroy();
  dataEditorView = null;
}

function renderSemanticScreen(screen: SemanticScreen) {
  const sections = screen.sections.length
    ? screen.sections
    : [{ id: "raw", kind: "plain", title: "Output", text: screen.rawText, lines: screen.rawText.split("\n"), confidence: 0.3, bounds: { x: 0, y: 0, width: 1, height: 1 } }];

  return `
    <div class="semantic-grid">
      ${sections.map((section) => `
        <article class="semantic-section kind-${escapeAttr(section.kind)}" data-kind="${escapeAttr(section.kind)}" data-testid="semantic-section">
          <header>
            <strong>${escapeHtml(section.title || section.kind)}</strong>
            <span>${escapeHtml(section.kind)}</span>
          </header>
          <pre>${escapeHtml(section.text || section.lines.join("\n"))}</pre>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSessionLink(session: any) {
  return `
    <a class="session-link" href="/sessions/${escapeAttr(session.id)}">
      <span class="status-dot" data-state="${escapeAttr(session.status)}"></span>
      <span>
        <strong>${escapeHtml(session.title || session.command)}</strong>
        <code>${escapeHtml([session.command, ...session.args].join(" "))}</code>
      </span>
      <time>${escapeHtml(new Date(session.updatedAt).toLocaleTimeString())}</time>
    </a>
  `;
}

function renderKeyButton(key: string, label: string) {
  return `<button type="button" class="icon-button" data-key="${escapeAttr(key)}" aria-label="${escapeAttr(key)}">${escapeHtml(label)}</button>`;
}

function firstLine(text: string) {
  return text.split("\n").map((line) => line.trim()).find(Boolean) || "";
}

function keyNameFromKeyboardEvent(event: KeyboardEvent) {
  if (event.key === "Escape") return "esc";
  if (event.key === "Tab") return "tab";
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  if (event.key === "ArrowLeft") return "left";
  if (event.key === "ArrowRight") return "right";
  if (event.key === "Backspace") return "backspace";
  if (event.ctrlKey && event.key.toLowerCase() === "c") return "ctrl+c";
  return "";
}

function parseArgs(input: string) {
  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return await response.json() as T;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}
