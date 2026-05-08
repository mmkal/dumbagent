# TUI UI Context

## Glossary

- **TUI UI**: A local browser interface for a terminal UI. It is not only a terminal emulator; it tries to translate the current terminal screen into browser-native HTML while keeping the raw terminal view available.
- **Managed session**: One subprocess running inside a Bun-owned PTY, with a current screen, event log, lifecycle, and browser input channel.
- **Terminal screen**: The lossless xterm-headless model of the subprocess output. This is the source of truth for replay and fallback rendering.
- **Semantic screen**: A derived model of the terminal screen that groups visible text into sections such as boxes, prompts, status rows, tool output, and plain text blocks.
- **Section**: A detected meaningful region of the semantic screen. Sections may come from box drawing characters, contiguous text blocks, prompts, or status lines.
- **Composer**: The browser-side text input used to send text to the managed session. It is intentionally separate from the semantic screen because a generic TUI does not expose focus semantics.
- **Chord**: A named terminal key sequence, such as `esc`, `tab`, `ctrl+c`, or `/model;enter`, that can be sent without typing raw escape codes.

## Boundaries

- TUI UI owns PTY process execution, screen interpretation, browser rendering, and browser input.
- TUI UI does not attempt to understand every application-specific state machine in a TUI.
- The semantic screen is allowed to be imperfect as long as the raw terminal view remains available and input still reaches the subprocess.

