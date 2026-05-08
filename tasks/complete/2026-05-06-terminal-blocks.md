---
status: done
size: medium
---

# Terminal Blocks Layer

Status summary: Done. TUI UI now has a deterministic block model between xterm cells and semantic labels, plus a browser `Blocks` tab for inspecting that model as JSON.

## Checklist

- [x] Parse the xterm buffer into styled cells. _Implemented in `src/terminal-blocks.ts` with fixed-grid cells containing char, fg, bg, flags, and style key._
- [x] Detect geometric blocks before semantic labels. _Implemented border-box, style-region, and text-block detection with top-left coordinate bounds and exclusive `x1`/`y1`._
- [x] Add a `Blocks` browser tab. _Implemented in `client/app.ts`; it shows a summary list plus CodeMirror-backed JSON._
- [x] Use CodeMirror for parsed JSON. _Implemented with direct `@codemirror/lang-json`, `@codemirror/state`, and `@codemirror/view` usage, following sqlfu's CodeMirror substrate without pulling React into this app._
- [x] Cover block parsing and browser rendering in tests. _Added `test/terminal-blocks.test.ts` and extended `spec/tuiui.spec.ts`._

## Implementation Notes

- The block model intentionally records geometry, style, and text without claiming app-specific meaning.
- The coordinate system is explicit in the JSON: origin is top-left and `x1`/`y1` are exclusive.
- Unknown session routes now render a recovery page instead of throwing, because in-memory sessions disappear when the server restarts.

