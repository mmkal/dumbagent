---
status: needs-grilling
size: medium
---

# Keyboard Shortcut Chords

Status: Not started. Needs a grill-you-with-docs style pass before implementation so shortcut terminology and the intended feature set are clear. Main goal is to borrow the shortcut/chord model from `../xyz`, including user-defined chords and binary-aware rendering.

- [ ] Clarify terminology for shortcuts, chords, rendered keys, and binary-specific behavior.
- [ ] Compare the desired feature set with `../xyz` and note which pieces should be copied or adapted.
- [ ] Add a way to create new chords, with chords allowed to be spelled out directly.
- [ ] Add an LRU-style selection system based on the binary being run, such as `codex`, `opencode`, or `claude`.
- [ ] Render the most relevant chords per binary, for example `Esc` for Codex, `Esc;Esc` for OpenCode, or `Ctrl-J` for newline where appropriate.
