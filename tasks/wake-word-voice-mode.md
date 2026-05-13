---
status: idea
size: medium
---

# Wake Word For Voice Mode

Status: Captured as an early idea. The main desired outcome is hands-free activation of the existing voice mode; no implementation has started. The biggest missing pieces are validating a no-paid-service wake-word path, deciding how custom phrase quality should be evaluated, and choosing the smallest prototype that proves the interaction feels usable.

## Goal

Let the user enable an always-listening wake-word mode so a phrase like "listen here chump" starts voice transcription without pressing the Talk button.

## Notes

The important product behavior is: when wake-word mode is enabled, TUI UI listens locally or through the user's own backend infrastructure, detects the configured phrase, gives some clear feedback that it is now recording the actual command, and then hands off to the existing voice prompt/readback loop.

This should not introduce a paid third-party wake-word service. A backend-assisted open-source detector is acceptable and probably more realistic than trying to do everything inside browser APIs. The browser may still need to capture microphone audio and stream it to the backend, especially when the UI is running on a phone.

It is fine for the first version to support "wake phrase, then command" rather than trying to capture a full sentence like "listen here chump what changed in the repo" without a pause. Seamless phrase-plus-command capture can be treated as a later refinement if the first interaction is useful.

## Checklist

- [ ] Explore open-source wake-word options that can run without a paid service.
- [ ] Prototype the smallest wake-word detection path that can activate the existing voice loop.
- [ ] Decide how the wake phrase should be configured, including whether "listen here chump" is hard-coded for the first slice or user-configurable.
- [ ] Make wake-word mode explicitly opt-in with clear mic/listening state in the UI.
- [ ] Pause or suppress wake-word detection while TUI UI is speaking readback audio.
- [ ] Add a way to cancel, disable, or recover if wake-word mode is behaving badly.
- [ ] Add focused tests or a manual verification script that proves wake detection activates transcription without regressing push-to-talk.

## Open Questions

- What false-positive rate is tolerable before this becomes annoying?
- Does the first slice need to work from mobile Safari/Chrome, desktop Chrome, or both?
- Should the backend wake-word worker be managed by TUI UI or documented as an external dependency?
- How should custom wake phrase training/import be handled if the detector does not already support the chosen phrase well?

## Implementation Log

- 2026-05-12: Captured the idea after discussing a no-paid-service backend-assisted approach for wake-word activation.
