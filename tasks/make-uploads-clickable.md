---
status: ready-for-review
size: small
---

Status: Ready for review. Absolute and relative image paths in raw terminal output are clickable in xterm and open an inline preview popover. The server now has a constrained local image preview endpoint, and the flow is covered by a touch-enabled mobile-width browser spec.

- [x] Detect image paths in xterm output. _Implemented with an xterm `registerLinkProvider` in `client/app.ts` for absolute and relative paths ending in common image extensions._
- [x] Open detected terminal image paths in a preview popover. _Implemented as `.terminal-image-popover` inside the raw TTY surface, anchored near the click/tap._
- [x] Serve local image paths through a constrained preview endpoint. _Added `GET /api/image-preview?path=...` in `cli.ts`, with relative paths resolved against the active session cwd supplied by the client._
- [x] Cover the terminal image path flow in a browser spec. _Added a touch-enabled mobile-width Playwright spec that prints an absolute `.png` path, taps it in xterm, and verifies the preview image loads._

## Implementation Notes

- Scope for this pass: absolute and relative paths with image extensions in the raw TTY renderer, including uploaded attachment paths printed by agents.
- Verification: `bun run typecheck`; mobile HITL tap checks for image paths and long HTTP links. Specs were not run during the active HITL pass per request.
- Follow-up fix: mobile taps now use a capture-phase pointer handler that resolves the tapped xterm buffer cell directly before xterm focuses its helper textarea.
- Follow-up fix: manually line-broken path fragments are reassembled across adjacent terminal lines so long image paths behave like long HTTP links.
