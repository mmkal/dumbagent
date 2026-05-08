# ADR 0001: Bun PTY plus derived semantic screen

## Status

Accepted

## Context

The product needs to run real interactive TUIs such as OpenCode and make them usable in a browser. A browser UI can render xterm HTML directly, but that does not expose higher-level regions or meanings. A pure semantic parser is also too risky because terminal output is inherently lossy and app-specific.

## Decision

Use Bun's PTY support to run the subprocess. Feed PTY output into xterm-headless as the terminal source of truth, then derive a semantic screen from the current xterm viewport. The browser defaults to the semantic screen and keeps an xterm-style terminal view as fallback.

## Consequences

- TUI UI can support real TUIs without tmux or node-pty.
- The semantic layer can improve over time without changing process execution.
- Tests can assert both the raw terminal behavior and the interpreted browser sections.
- Some TUIs will initially render imperfect semantic sections, so the fallback terminal view and raw key/chord input remain required product surface.

