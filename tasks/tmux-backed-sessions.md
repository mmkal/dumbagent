---
status: ready
size: medium
---

# Tmux-Backed Sessions

Status: Not started. Current sessions are not tmux-backed; `cli.ts` explicitly says TUI UI uses Bun PTY support directly instead of tmux. Goal is to evaluate and, if worthwhile, switch or add an option for tmux-backed sessions so agent processes can survive browser/server restarts and be attachable from a terminal.

- [ ] Document the current Bun PTY session lifecycle and what breaks when the TUI UI server exits.
- [ ] Decide whether tmux should replace Bun PTY or be an optional backend.
- [ ] Define session naming, cwd, environment, resize, input, output capture, and cleanup behavior for tmux sessions.
- [ ] Preserve browser terminal streaming and existing SDK summary behavior.
- [ ] Add integration coverage for launching, sending input, resizing, and reconnecting to an existing tmux-backed session.
