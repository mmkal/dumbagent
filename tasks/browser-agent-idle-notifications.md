---
status: ready
size: medium
---

# Browser Agent Idle Notifications

Status: Task captured and ready for a first implementation pass. The main completed piece is the product shape: notify the browser user when any agent transitions from busy to idle. The main missing pieces are permission UX details, duplicate-notification suppression, and final wording for notification titles/bodies.

## Goal

Send native browser notifications when an agent session finishes work and becomes idle, so the user can leave TUI UI open in the background and still know when an agent needs attention.

## Notes

The notification should be about agent state transitions, not every polling refresh. A session that starts busy and later returns to idle should notify once. A session already idle on first page load should not notify.

Use the browser Notification API for the first slice. Keep the implementation local to the web client unless the server needs to expose richer state. If browser notifications are blocked or unsupported, degrade to the existing in-app toast system and make the disabled state visible without noisy prompts.

The feature should work for Codex first, but the state model should be provider-neutral because TUI UI already tracks Codex, Claude, and OpenCode sessions with the same `busy`/`idle`/`exited` surface.

## Checklist

- [ ] Identify the current client-side polling/status update path that observes agent session status.
- [ ] Add transition tracking so notifications fire only on `busy` to `idle`.
- [ ] Add an explicit browser-notification permission request flow instead of asking on first page load.
- [ ] Include enough context in the notification to identify the provider, title, and working directory or task.
- [ ] Suppress duplicate notifications across rapid polling refreshes and page reload initialization.
- [ ] Fall back to an in-app toast when browser notifications are denied or unavailable.
- [ ] Add focused tests for transition detection, duplicate suppression, and no notification on initially idle sessions.
- [ ] Manually verify the browser notification behavior in Chrome with the TUI UI tab backgrounded.

## Open Questions

- Should this notify for every agent, or only sessions the user has marked as watched?
- Should notifications fire when an agent is waiting for user input if that is represented separately from idle later?
- Should clicking a notification focus the relevant session, and if so should this use the current URL hash/router state?
- Should the setting persist per browser, per project, or per TUI UI server instance?

## Implementation Log

- 2026-05-13: Captured task after confirming there was no active task, branch, PR, or code path for native browser notifications on idle transitions.
