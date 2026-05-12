import { expect, test } from "bun:test";
import { createAcknowledgement, createReadbackText, createVoiceLoop, type VoiceRecognizer, type VoiceSpeaker } from "../client/voice.ts";

test("voice loop sends final transcripts and reads back after the session returns idle", async () => {
  let now = Date.parse("2026-05-11T10:00:00.000Z");
  const spoken: string[] = [];
  const sent: string[] = [];
  const recognizer = fakeRecognizer();
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => now,
    minReadbackDelayMs: 0,
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "what is one plus two", final: true });
  await Promise.resolve();

  expect(sent).toEqual(["what is one plus two"]);
  expect(spoken).toEqual([createAcknowledgement("what is one plus two")]);
  expect(loop.state).toMatchObject({
    status: "idle",
    transcript: "what is one plus two",
    awaitingReadback: true,
  });

  now += 100;
  loop.observePayload({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:01.000Z",
    renderedText: "Ask anything\nAnswer\nthree",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "what is one plus two",
        latestAssistantText: "three",
        transcript: [
          message("user", "what is one plus two", "2026-05-11T10:00:00.100Z"),
          message("assistant", "three", "2026-05-11T10:00:01.000Z"),
        ],
      },
    },
  });

  expect(spoken).toEqual([
    createAcknowledgement("what is one plus two"),
    "three",
  ]);
  expect(loop.state).toMatchObject({
    status: "idle",
    awaitingReadback: false,
    message: "Readback complete",
  });
});

test("voice loop waits for a fresh provider assistant message before readback", async () => {
  let now = Date.parse("2026-05-11T10:00:00.000Z");
  const spoken: string[] = [];
  const recognizer = fakeRecognizer();
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => now,
    minReadbackDelayMs: 0,
    async sendTranscript() {
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "what is the status", final: true });
  await Promise.resolve();

  now = Date.parse("2026-05-11T10:00:02.000Z");
  loop.observePayload({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:02.000Z",
    renderedText: "stale terminal output",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "previous question",
        latestAssistantText: "penultimate answer",
        transcript: [
          message("user", "previous question", "2026-05-11T09:59:00.000Z"),
          message("assistant", "penultimate answer", "2026-05-11T09:59:01.000Z"),
        ],
      },
    },
  });

  expect(spoken).toEqual([createAcknowledgement("what is the status")]);
  expect(loop.state).toMatchObject({
    awaitingReadback: true,
  });

  loop.observePayload({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:03.000Z",
    renderedText: "fresh terminal output",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "what is the status",
        latestAssistantText: "fresh answer",
        transcript: [
          message("user", "previous question", "2026-05-11T09:59:00.000Z"),
          message("assistant", "penultimate answer", "2026-05-11T09:59:01.000Z"),
          message("user", "what is the status", "2026-05-11T10:00:00.200Z"),
          message("assistant", "fresh answer", "2026-05-11T10:00:02.500Z"),
        ],
      },
    },
  });

  expect(spoken).toEqual([
    createAcknowledgement("what is the status"),
    "fresh answer",
  ]);
});

test("voice loop can be tested without a microphone or system speech", () => {
  const spoken: string[] = [];
  const recognizer = fakeRecognizer();
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => 1,
    minReadbackDelayMs: 0,
    async sendTranscript() {
      throw new Error("cancelled transcripts should not send");
    },
  });

  loop.startListening();
  loop.cancelListening();
  recognizer.emit({ transcript: "ignore this", final: true });

  expect(spoken).toEqual([]);
  expect(loop.state).toMatchObject({
    status: "idle",
    message: "Listening cancelled",
  });
});

test("readback prefers SDK assistant text and falls back to trailing terminal text", () => {
  expect(createReadbackText({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:00.000Z",
    renderedText: "terminal fallback",
    sdk: {
      provider: "codex",
      summary: {
        latestAssistantText: "provider answer",
      },
    },
  })).toBe("provider answer");

  expect(createReadbackText({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:00.000Z",
    renderedText: "Find and fix a bug in @filename",
    sdk: {
      provider: "codex",
      summary: null,
    },
  })).toBe("");

  expect(createReadbackText({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:00.000Z",
    renderedText: "line one\nline two\nline three\nline four\nline five",
    sdk: {
      provider: "",
      summary: null,
    },
  })).toBe("line two. line three. line four. line five");
});

test("readback rejects provider assistant text that predates the voice prompt", () => {
  expect(createReadbackText({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:00.000Z",
    renderedText: "terminal fallback should not leak",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "previous question",
        latestAssistantText: "penultimate answer",
        transcript: [
          message("user", "previous question", "2026-05-11T09:59:00.000Z"),
          message("assistant", "penultimate answer", "2026-05-11T09:59:01.000Z"),
        ],
      },
    },
  }, {
    promptSentAt: Date.parse("2026-05-11T10:00:00.000Z"),
    promptText: "what is the status",
  })).toBe("");
});

function message(role: string, text: string, createdAt: string) {
  return { role, text, createdAt };
}

function fakeRecognizer() {
  let handlers: Parameters<VoiceRecognizer["start"]>[0] | null = null;
  const recognizer: VoiceRecognizer & { emit: (result: { transcript: string; final: boolean }) => void } = {
    supported: true,
    start(nextHandlers) {
      handlers = nextHandlers;
    },
    stop() {
    },
    cancel() {
      handlers = null;
    },
    emit(result) {
      handlers?.onResult(result);
    },
  };
  return recognizer;
}

function fakeSpeaker(spoken: string[]): VoiceSpeaker {
  return {
    supported: true,
    speak(text) {
      spoken.push(text);
    },
    stop() {
      spoken.push("[stop]");
    },
  };
}
