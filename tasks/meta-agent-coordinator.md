---
status: needs-grilling
size: large
---

# Meta-Agent Coordinator

Status: Task captured as a large product slice. The desired outcome is clear at a high level: a lightweight coordinator agent that watches other sessions, summarizes what they are doing, helps route the user's voice prompts, and coordinates between agents. The main missing pieces are the exact authority boundaries, the session-state representation, and how much autonomous action the coordinator may take.

## Goal

Build a somewhat dumb meta-agent whose job is to keep an eye on other agent sessions, talk to the user about how those sessions are going, coordinate between them, and relay rough voice-directed prompts to the right session.

## Notes

The coordinator is not meant to be a deeply independent planner. It should be closer to an operations assistant for the human: maintain a live "state of the agents" view, notice stale or idle sessions, answer "what's going on?", and send user instructions to the appropriate session when the user talks through work over voice.

This probably needs a structured session summary representation that is useful to humans, agents, and the UI. It should include active and recent sessions, provider, title, cwd/repo, branch/worktree, status, last activity, current task summary, blockers, pending user decisions, PR/task links, and confidence/freshness. The representation should be cheap to update and should degrade gracefully when a provider cannot expose a rich summary.

The first useful version can be conservative: observe sessions, maintain summaries, and ask before sending prompts. Later versions can coordinate more actively, such as nudging one agent with context from another, asking a reviewer agent to inspect a PR, or suggesting follow-up work.

## Checklist

- [ ] Define the session-state summary schema for active and recent agents.
- [ ] Identify the current sources of truth for sessions, titles, providers, status, cwd, branches, task files, and PRs.
- [ ] Add a backend or client-visible endpoint that returns a consolidated state-of-the-agents summary.
- [ ] Create a coordinator session type or role that can read the summary and produce concise status updates for the user.
- [ ] Add a voice-routing flow where the user can roughly address an agent and the coordinator resolves the target session.
- [ ] Require explicit user confirmation before the coordinator sends a prompt into another agent session in the first version.
- [ ] Add an audit trail showing what the coordinator observed, summarized, and forwarded.
- [ ] Add tests around summary freshness, target-session resolution, and prompt-forwarding confirmation.
- [ ] Document the coordinator's authority boundaries so future agents do not make it too autonomous by accident.

## Open Questions

- Should the meta-agent itself be a normal Codex/Claude/OpenCode session, or a dedicated deterministic coordinator with optional LLM calls?
- What is the minimal summary that can be generated reliably across Codex, Claude, and OpenCode?
- How should it identify "who is working on what" when the session title is vague or stale?
- Should it read task files, git branches, PR metadata, process state, browser state, or all of those?
- How should voice commands disambiguate between several plausible target agents?
- Can the coordinator send prompts to agents running outside TUI UI, or only sessions that TUI UI owns?
- What should it do when two agents are about to edit the same files or otherwise conflict?

## Implementation Log

- 2026-05-13: Captured task from the request for a dumb coordinating meta-agent that can track separate sessions and relay rough voice prompts.
