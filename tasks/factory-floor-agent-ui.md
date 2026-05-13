---
status: idea
size: large
---

# Factory Floor Agent UI

Status: Task captured as a visual/product exploration. The high-level direction is to make an agent operations UI inspired by Isomux's visual office metaphor, but reframe it as a factory floor for TUI UI's multi-agent workflow. The main missing pieces are the concrete interaction model, the degree of animation/skeuomorphism, and whether this replaces or complements the current session list.

## Goal

Design and build a factory-floor-style multi-agent UI where active and recent agents are represented as workstations, production lines, bays, or machines, making it easy to see at a glance who is working, idle, blocked, waiting for the user, or done.

## Reference

Isomux is the main inspiration: https://isomux.com/

Relevant ideas from the reference are the visual office metaphor, animated characters for sleeping/typing/waiting states, mobile-friendly access, embedded terminal per agent, voice input, task board, inter-agent discovery, and completion notifications.

TUI UI should not copy the office metaphor directly. The requested direction is a factory floor: agent stations, task queues, work-in-progress lanes, supervisor controls, status lights, handoff belts, inspection/review areas, and visible bottlenecks.

## Notes

The UI should be useful before it is cute. It needs to preserve fast access to real terminals, session briefs, provider details, task files, branches, and PRs. The factory metaphor should improve scanning and coordination, not hide important operational details behind decoration.

Possible visual states:

- Agent working: station active, status light running, visible recent output/activity pulse.
- Agent idle: station quiet, completed item ready for inspection.
- Agent waiting for user: call light or blocked lane.
- Agent errored/exited: stopped machine with clear recovery action.
- Agent reviewing another agent: inspection station or quality-control lane.

The first version can be a new route or mode alongside the current list/detail UI. It should avoid a large rewrite until the state model and visual grammar prove useful.

## Checklist

- [ ] Audit the current session list/detail UI and identify the data needed for a factory-floor overview.
- [ ] Sketch the factory-floor information architecture: stations, lanes, queues, inspection area, and detail drawer.
- [ ] Define visual state mapping for busy, idle, waiting-for-user, exited, errored, reviewing, and stale sessions.
- [ ] Build a first responsive overview route that shows active and recent sessions as stations.
- [ ] Preserve one-click access to the terminal/session detail for each station.
- [ ] Add compact controls for spawning, resuming, stopping, and sending a prompt to an agent.
- [ ] Integrate task/branch/PR/status summary data when available, without blocking the first UI on perfect metadata.
- [ ] Add mobile layout behavior that keeps the overview scannable and makes station controls touch-friendly.
- [ ] Add Playwright coverage for the overview states and at least one screenshot/video artifact for PR review.

## Open Questions

- Should the factory floor be the default home screen or an alternate overview mode?
- Should the art direction be flat and utilitarian, or skeuomorphic with animated machines and characters?
- What is the right density for mobile: mini-map overview, list of stations, or swipeable station cards?
- Should the UI expose the meta-agent/coordinator as a supervisor booth or a normal station?
- How much of Isomux's task board idea should be adapted versus relying on this repo's `tasks/` folder?

## Implementation Log

- 2026-05-13: Captured task after reviewing Isomux's published feature list and reframing the desired UI as a factory-floor operations view for TUI UI.
