---
status: in-progress
size: medium
---

# SDK-Based TUI Summary Pivot

Status: first slice implemented. TUI UI now launches OpenCode with a deterministic local server port, exposes an SDK-backed Summary tab, and uses the OpenCode TUI API for prompt submission when available. Remaining work is to deepen this into true AI summary UX and add Codex/Claude adapters.

- [x] Stop treating ASCII/box parsing as the main path for summarization. _The browser now defaults to TTY and exposes Summary instead of Blocks; block parsing remains in code only as a lower-level diagnostic._
- [x] Launch OpenCode TUIs with a deterministic local server port so TUI UI can connect to the same server the TUI is using. _`prepareSessionSdk` appends/normalizes `opencode --hostname 127.0.0.1 --port <free-port>` in `cli.ts`._
- [x] Add an SDK/provider summary model to the session payload. _`SessionSdkPayload` carries provider, base URL, provider session ID, status, errors, transcript, and diff counts._
- [x] Implement OpenCode as the first provider using its server SDK/API. _`refreshSessionSdk`, `summarizeSessionWithSdk`, and `sendOpenCodePromptThroughSdk` use `@opencode-ai/sdk/client`._
- [x] Add a browser view/action for summary data. _The session toolbar now has a Summary tab with Refresh SDK and Summarize via SDK actions._
- [x] Cover the behavior with an integration spec. _`spec/tuiui.spec.ts` drives fake OpenCode, then verifies SDK transcript/status includes the prompt and response._
- [ ] Add Codex adapter. _Needs reliable mapping from a running TUI to Codex thread/session ID._
- [ ] Add Claude adapter. _Needs reliable mapping from a running TUI to Claude session ID or explicit launch session ID._
- [ ] Design non-mutating AI summaries. _OpenCode `session.summarize` appears to be a compact/summarize operation on the source session; we probably want a sidecar summary that does not alter the agent._

## Implementation Notes

- OpenCode docs say the TUI starts a server, and `--hostname`/`--port` can make that server address deterministic. Its SDK exposes session, message, status, diff, summarize, and TUI-control APIs.
- Codex has a TypeScript SDK that resumes persisted threads by ID, but tying a running TUI to the thread ID looks like a separate adapter after this OpenCode slice.
- Claude has session resume/structured-output SDK APIs, but the current CLI surface makes OpenCode the easiest proof first.
- 2026-05-08: First pass keeps parser files/tests around because they are still useful diagnostics, but removes Blocks from the main browser toolbar. TTY is now the default route.
