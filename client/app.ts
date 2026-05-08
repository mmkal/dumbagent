import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vsCodeDark } from "@fsegurai/codemirror-theme-bundle";
import { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { basicSetup } from "codemirror";
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
  renderedAnsi?: string;
  blocks: TerminalBlockModel;
  semantic: SemanticScreen;
  sdk: SessionSdkPayload;
  stdinEvents: Array<{ id: number; text: string; createdAt: string }>;
  stdoutEvents: Array<{ id: number; chunk: string; displayText: string; createdAt: string }>;
};

type SessionSdkPayload = {
  provider: "" | "opencode" | "codex";
  state: "unavailable" | "ready" | "connected" | "not-found" | "error";
  baseUrl: string;
  externalSessionId: string;
  status: string;
  updatedAt: string;
  error: string;
  sidecarSummary: SidecarSummaryState;
  forks: SidecarSummaryFork[];
  summary: null | {
    provider: "opencode" | "codex";
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
  method: "" | "opencode.session.fork+summarize" | "codex.startThread+summary";
  sourceSessionId: string;
  forkSessionId: string;
  updatedAt: string;
  result: boolean | null;
  error: string;
  note: string;
};

type SidecarSummaryFork = {
  provider: "opencode" | "codex";
  purpose: "sidecarSummary";
  sourceSessionId: string;
  forkSessionId: string;
  createdAt: string;
  updatedAt: string;
  status: "created" | "summarized" | "error";
  result: boolean | null;
  error: string;
  summary: SessionSdkPayload["summary"];
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
let dataEditorKind: "" | "sdk-yaml" | "blocks-json" = "";
let dataEditorDoc = "";
let eventsPaused = false;
let terminalResizeObserver: ResizeObserver | null = null;
let terminalResizeTimer: number | null = null;
let lastTerminalResizeKey = "";
let xterm: XtermTerminal | null = null;
let xtermFit: FitAddon | null = null;
let xtermReady: Promise<XtermTerminal> | null = null;
let xtermSessionId = "";
let xtermLastStdoutEventId = 0;
let xtermInputQueue = Promise.resolve();
let xtermSyncQueue = Promise.resolve();

void renderRoute();

window.addEventListener("popstate", () => {
  void renderRoute();
});

async function renderRoute() {
  events?.close();
  events = null;
  eventsPaused = false;
  stopTerminalAutoResize();
  destroyXterm();
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
        <a class="brand" href="/">tuiui</a>
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
        <a class="brand" href="/">tuiui</a>
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
      <header class="topbar session-appbar">
        <a class="brand" href="/">tuiui</a>
        <code class="command app-title" title="${escapeAttr([payload.command, ...payload.args].join(" "))}" data-testid="session-command">${escapeHtml(payload.title || payload.command)}</code>
        <span class="status-pill" data-state="${payload.status}" data-testid="session-status">${payload.status}</span>
        <details class="session-menu">
          <summary class="menu-button" role="button" aria-label="Session menu">☰</summary>
          <div class="menu-panel">
            <div class="menu-fact">
              <span>CWD</span>
              <code>${escapeHtml(payload.cwd)}</code>
            </div>
            <div class="toolbar" role="group" aria-label="Renderer">
              <button type="button" class="icon-button" data-renderer="terminal" aria-pressed="${renderer === "terminal"}">TTY</button>
              <button type="button" class="icon-button" data-renderer="sdk" aria-pressed="${renderer === "sdk"}">Summary</button>
              <button type="button" class="icon-button" data-renderer="semantic" aria-pressed="${renderer === "semantic"}">HTML</button>
              <button type="button" class="icon-button" data-action="pause-events" aria-pressed="false">Pause events</button>
              <button type="button" class="icon-button" data-action="logs" aria-expanded="false">Logs</button>
              <button type="button" class="icon-button danger" data-action="kill">Stop</button>
            </div>
          </div>
        </details>
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
            ${renderKeyButton("left", "←", "overflow-key")}
            ${renderKeyButton("right", "→", "overflow-key")}
            ${renderKeyButton("ctrl+c", "^C", "overflow-key")}
            <details class="key-overflow">
              <summary class="icon-button key-more" role="button" aria-label="More keys">...</summary>
              <div class="key-overflow-panel">
                ${renderKeyButton("left", "←")}
                ${renderKeyButton("right", "→")}
                ${renderKeyButton("ctrl+c", "^C")}
              </div>
            </details>
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
      closeSessionMenu();
    });
  });

  document.querySelector<HTMLButtonElement>("[data-action='logs']")?.addEventListener("click", (event) => {
    const logs = document.getElementById("logs")!;
    logs.hidden = !logs.hidden;
    (event.currentTarget as HTMLButtonElement).setAttribute("aria-expanded", String(!logs.hidden));
    closeSessionMenu();
  });

  document.querySelector<HTMLButtonElement>("[data-action='pause-events']")?.addEventListener("click", () => {
    setEventsPaused(sessionId, !eventsPaused);
    closeSessionMenu();
  });

  document.querySelector<HTMLButtonElement>("[data-action='kill']")?.addEventListener("click", () => {
    void api(`/api/sessions/${sessionId}/kill`, { method: "POST" });
    closeSessionMenu();
  });
}

function closeSessionMenu() {
  document.querySelector<HTMLDetailsElement>(".session-menu")?.removeAttribute("open");
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
  if (eventsPaused) {
    updatePauseEventsButton();
    return;
  }
  events = new EventSource(`/api/sessions/${sessionId}/events`);
  events.addEventListener("session", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as SessionPayload;
    renderSessionPayload(payload);
  });
  updatePauseEventsButton();
}

function setEventsPaused(sessionId: string, paused: boolean) {
  eventsPaused = paused;
  if (paused) {
    events?.close();
    events = null;
    updatePauseEventsButton();
    return;
  }
  subscribe(sessionId);
}

function updatePauseEventsButton() {
  const button = document.querySelector<HTMLButtonElement>("[data-action='pause-events']");
  if (!button) {
    return;
  }
  button.setAttribute("aria-pressed", String(eventsPaused));
  button.textContent = eventsPaused ? "Resume events" : "Pause events";
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
  const command = document.querySelector<HTMLElement>("[data-testid='session-command']");
  if (command) {
    command.textContent = payload.title || payload.command;
    command.title = [payload.command, ...payload.args].join(" ");
  }
  document.querySelectorAll<HTMLButtonElement>("[data-renderer]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.renderer === renderer));
  });

  const screen = document.getElementById("screen")!;
  if (renderer === "terminal") {
    destroyDataEditor();
    renderTerminalScreen(screen, payload);
  } else if (renderer === "sdk") {
    stopTerminalAutoResize();
    destroyXterm();
    renderSdkScreen(screen, payload);
  } else {
    stopTerminalAutoResize();
    destroyXterm();
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

function renderTerminalScreen(screen: HTMLElement, payload: SessionPayload) {
  screen.className = "screen terminal-screen";
  if (payload.renderedAnsi === undefined && payload.renderedHtml) {
    destroyXterm();
    screen.innerHTML = `<div class="terminal-html" data-testid="rendered-terminal">${trimTerminalHtmlToRows(payload.renderedHtml, payload.rows)}</div>`;
    startTerminalAutoResize(payload.id);
    return;
  }

  if (!screen.querySelector("#xterm-terminal")) {
    destroyXterm();
    screen.innerHTML = `
      <div class="terminal-xterm-wrap" data-testid="rendered-terminal">
        <div id="xterm-terminal" class="terminal-host"></div>
        <pre class="terminal-text-snapshot" aria-hidden="true"></pre>
      </div>
    `;
  }

  const snapshot = screen.querySelector<HTMLElement>(".terminal-text-snapshot");
  if (snapshot) {
    snapshot.textContent = payload.renderedText;
  }
  xtermSyncQueue = xtermSyncQueue.then(() => syncXterm(payload)).catch(() => undefined);
  startTerminalAutoResize(payload.id);
}

async function ensureXterm(payload: SessionPayload) {
  const host = document.getElementById("xterm-terminal");
  if (!host) {
    return null;
  }
  if (xterm && xtermSessionId === payload.id) {
    return xterm;
  }
  destroyXterm();
  xtermSessionId = payload.id;
  xtermReady = import("@xterm/xterm").then(({ Terminal }) => {
    const term = new Terminal({
      cols: payload.cols,
      rows: payload.rows,
      convertEol: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 14,
      lineHeight: 1.18,
      theme: {
        background: "#0a0a0a",
        foreground: "#d6deeb",
      },
      allowTransparency: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    xtermFit = fit;
    term.onData((text) => {
      if (!xtermSessionId) {
        return;
      }
      const sessionId = xtermSessionId;
      xtermInputQueue = xtermInputQueue
        .then(() => api(`/api/sessions/${sessionId}/send`, {
          method: "POST",
          body: JSON.stringify({ text, submit: false }),
        }))
        .then(() => undefined)
        .catch(() => undefined);
    });
    xterm = term;
    return term;
  });
  return await xtermReady;
}

async function syncXterm(payload: SessionPayload) {
  const term = await ensureXterm(payload);
  if (!term || xtermSessionId !== payload.id) {
    return;
  }

  term.resize(payload.cols, payload.rows);
  const newestEvent = payload.stdoutEvents[payload.stdoutEvents.length - 1];
  const newestId = newestEvent ? newestEvent.id : 0;
  if (xtermLastStdoutEventId === 0 || newestId < xtermLastStdoutEventId) {
    term.reset();
    if (payload.renderedAnsi) {
      await writeXterm(term, payload.renderedAnsi);
      xtermLastStdoutEventId = newestId;
      return;
    }
    await writeXterm(term, payload.renderedText.replaceAll("\n", "\r\n"));
    xtermLastStdoutEventId = newestId;
    return;
  }

  if (newestId === xtermLastStdoutEventId) {
    return;
  }

  const visibleEvents = payload.stdoutEvents.filter((event) => event.id > xtermLastStdoutEventId);
  const events = visibleEvents.length
    ? visibleEvents
    : (await fetchStdoutEvents(payload.id, xtermLastStdoutEventId).catch(() => ({ events: [] }))).events;
  if (xtermSessionId !== payload.id) {
    return;
  }
  for (const event of events) {
    await writeXterm(term, event.chunk);
    xtermLastStdoutEventId = event.id;
  }
}

async function writeXterm(term: XtermTerminal, text: string) {
  await new Promise<void>((resolve) => {
    term.write(text, () => resolve());
  });
}

async function fetchStdoutEvents(sessionId: string, after: number) {
  return await api<{ events: SessionPayload["stdoutEvents"] }>(`/api/sessions/${sessionId}/stdout?after=${after}`);
}

function trimTerminalHtmlToRows(html: string, rows: number) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const wrapper = template.content.querySelector("pre > div");
  if (!wrapper) {
    return html;
  }

  const rowElements = [...wrapper.children];
  const removeCount = Math.max(0, rowElements.length - rows);
  for (const row of rowElements.slice(0, removeCount)) {
    row.remove();
  }

  const pre = template.content.querySelector("pre");
  return pre ? pre.outerHTML : template.innerHTML;
}

function destroyXterm() {
  xterm?.dispose();
  xterm = null;
  xtermFit = null;
  xtermReady = null;
  xtermSessionId = "";
  xtermLastStdoutEventId = 0;
  xtermInputQueue = Promise.resolve();
  xtermSyncQueue = Promise.resolve();
}

function startTerminalAutoResize(sessionId: string) {
  const screen = document.getElementById("screen");
  if (!screen || terminalResizeObserver) {
    scheduleTerminalResize(sessionId);
    return;
  }
  if (typeof ResizeObserver !== "undefined") {
    terminalResizeObserver = new ResizeObserver(() => {
      scheduleTerminalResize(sessionId);
    });
    terminalResizeObserver.observe(screen);
  } else {
    window.addEventListener("resize", handleWindowTerminalResize);
  }
  scheduleTerminalResize(sessionId);
}

function stopTerminalAutoResize() {
  terminalResizeObserver?.disconnect();
  terminalResizeObserver = null;
  lastTerminalResizeKey = "";
  window.removeEventListener("resize", handleWindowTerminalResize);
  if (terminalResizeTimer !== null) {
    window.clearTimeout(terminalResizeTimer);
    terminalResizeTimer = null;
  }
}

function handleWindowTerminalResize() {
  if (activeSession && renderer === "terminal") {
    scheduleTerminalResize(activeSession.id);
  }
}

function scheduleTerminalResize(sessionId: string) {
  if (renderer !== "terminal") {
    return;
  }
  if (terminalResizeTimer !== null) {
    window.clearTimeout(terminalResizeTimer);
  }
  terminalResizeTimer = window.setTimeout(() => {
    terminalResizeTimer = null;
    void resizeTerminalToScreen(sessionId);
  }, 120);
}

async function resizeTerminalToScreen(sessionId: string) {
  const screen = document.getElementById("screen");
  const terminal = screen?.querySelector<HTMLElement>(".terminal-xterm-wrap, .terminal-html");
  if (!screen || !terminal) {
    return;
  }
  const grid = measureTerminalGrid(screen, terminal);
  if (!grid) {
    return;
  }
  const resizeKey = `${grid.cols}x${grid.rows}`;
  if (resizeKey === lastTerminalResizeKey) {
    return;
  }
  lastTerminalResizeKey = resizeKey;
  await api(`/api/sessions/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify(grid),
  });
}

function measureTerminalGrid(screen: HTMLElement, terminal: HTMLElement) {
  const dimensions = xtermFit?.proposeDimensions();
  if (dimensions) {
    return {
      cols: dimensions.cols,
      rows: dimensions.rows,
    };
  }

  const screenStyles = getComputedStyle(screen);
  const terminalStyles = getComputedStyle(terminal);
  const horizontalPadding = parsePixel(screenStyles.paddingLeft) + parsePixel(screenStyles.paddingRight)
    + parsePixel(terminalStyles.paddingLeft) + parsePixel(terminalStyles.paddingRight);
  const verticalPadding = parsePixel(screenStyles.paddingTop) + parsePixel(screenStyles.paddingBottom)
    + parsePixel(terminalStyles.paddingTop) + parsePixel(terminalStyles.paddingBottom);

  const measure = document.createElement("span");
  measure.textContent = "MMMMMMMMMM";
  measure.style.position = "absolute";
  measure.style.visibility = "hidden";
  measure.style.whiteSpace = "pre";
  measure.style.font = terminalStyles.font;
  measure.style.lineHeight = terminalStyles.lineHeight;
  terminal.append(measure);
  const box = measure.getBoundingClientRect();
  measure.remove();

  const cellWidth = box.width / 10;
  const cellHeight = box.height;
  if (!cellWidth || !cellHeight) {
    return null;
  }

  return {
    cols: Math.floor((screen.clientWidth - horizontalPadding) / cellWidth),
    rows: Math.floor((screen.clientHeight - verticalPadding) / cellHeight),
  };
}

function parsePixel(value: string) {
  return Number.parseFloat(value) || 0;
}

function renderSdkScreen(screen: HTMLElement, payload: SessionPayload) {
  screen.className = "screen sdk-screen";

  const sdk = payload.sdk;
  if (!sdk.provider) {
    destroyDataEditor();
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

  const yamlDoc = stringifyYaml(buildSdkYamlData(payload), null, { lineWidth: 0 });
  const existingEditorHost = screen.querySelector("#sdk-yaml-editor");
  if (!existingEditorHost || dataEditorKind !== "sdk-yaml") {
    destroyDataEditor();
    screen.innerHTML = `
      <section class="sdk-panel" data-testid="sdk-summary">
        <header>
          <div>
            <strong><span data-sdk-provider></span> SDK</strong>
            <span data-sdk-base-url></span>
          </div>
          <span class="sdk-state" data-sdk-state></span>
          <button type="button" class="secondary-button" data-action="sdk-refresh">Refresh SDK</button>
          <button type="button" class="secondary-button" data-action="sdk-summarize">Summarize via SDK</button>
        </header>
        <p class="sdk-error" data-sdk-error hidden></p>
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
    mountYamlEditor("sdk-yaml-editor", yamlDoc);
  } else {
    updateDataEditorDoc(yamlDoc);
  }
  updateSdkChrome(screen, payload);
}

function updateSdkChrome(screen: HTMLElement, payload: SessionPayload) {
  const sdk = payload.sdk;
  const provider = screen.querySelector<HTMLElement>("[data-sdk-provider]");
  if (provider) {
    provider.textContent = sdk.provider;
  }
  const baseUrl = screen.querySelector<HTMLElement>("[data-sdk-base-url]");
  if (baseUrl) {
    baseUrl.textContent = sdk.baseUrl || "";
  }
  const state = screen.querySelector<HTMLElement>("[data-sdk-state]");
  if (state) {
    state.textContent = sdk.state;
    state.dataset.state = sdk.state;
  }
  const summarize = screen.querySelector<HTMLButtonElement>("[data-action='sdk-summarize']");
  if (summarize) {
    summarize.disabled = sdk.sidecarSummary.status === "running";
  }
  const error = screen.querySelector<HTMLElement>("[data-sdk-error]");
  if (error) {
    error.hidden = !sdk.error;
    error.textContent = sdk.error;
  }
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
    forks: payload.sdk.forks,
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
        basicSetup,
        vsCodeDark,
        yaml(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": "SDK data YAML" }),
        editorTheme(),
      ],
    }),
  });
  dataEditorKind = "sdk-yaml";
  dataEditorDoc = doc;
}

function updateDataEditorDoc(doc: string) {
  if (!dataEditorView || dataEditorDoc === doc) {
    return;
  }
  const scrollTop = dataEditorView.scrollDOM.scrollTop;
  const scrollLeft = dataEditorView.scrollDOM.scrollLeft;
  dataEditorView.dispatch({
    changes: {
      from: 0,
      to: dataEditorView.state.doc.length,
      insert: doc,
    },
  });
  dataEditorView.scrollDOM.scrollTop = scrollTop;
  dataEditorView.scrollDOM.scrollLeft = scrollLeft;
  dataEditorDoc = doc;
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
  const jsonDoc = JSON.stringify(model, null, 2);
  dataEditorView = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: jsonDoc,
      extensions: [
        basicSetup,
        vsCodeDark,
        json(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": "Parsed blocks JSON" }),
        editorTheme(),
      ],
    }),
  });
  dataEditorKind = "blocks-json";
  dataEditorDoc = jsonDoc;
}

function editorTheme() {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "#0d1014",
      color: "#eef2f7",
      fontSize: "12px",
      lineHeight: "1.45",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    ".cm-content": {
      padding: "6px 0",
    },
    ".cm-line": {
      lineHeight: "1.45",
      padding: "0 10px",
    },
    ".cm-gutters": {
      backgroundColor: "#11161d",
      color: "#748293",
      borderRightColor: "#2c333d",
      lineHeight: "1.45",
    },
    ".cm-gutterElement": {
      lineHeight: "1.45",
      paddingTop: "0 !important",
      paddingBottom: "0 !important",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      minWidth: "32px",
      paddingLeft: "7px !important",
      paddingRight: "7px !important",
    },
    ".cm-foldGutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "18px",
    },
    ".cm-foldGutter span": {
      display: "inline-flex",
      alignItems: "center",
      height: "1.45em",
      lineHeight: "1",
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
  dataEditorKind = "";
  dataEditorDoc = "";
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

function renderKeyButton(key: string, label: string, className = "") {
  const classes = ["icon-button", "key-button", className].filter(Boolean).join(" ");
  return `<button type="button" class="${escapeAttr(classes)}" data-key="${escapeAttr(key)}" aria-label="${escapeAttr(key)}">${escapeHtml(label)}</button>`;
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
