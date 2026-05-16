import { expect, test } from "bun:test";
import {
  createAcknowledgement,
  createFallbackVoiceRecognizer,
  createReadbackText,
  createVoiceLoop,
  voiceInterruptTextFromTranscript,
  voiceSendTextFromTranscript,
  type VoiceRecognizer,
  type VoiceSpeaker,
} from "../client/voice.ts";

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
    submitMode: "send-phrase",
    readbackMode: "enabled",
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "what is one plus two ok send", final: false, finalTranscript: "" });
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
    submitMode: "send-phrase",
    readbackMode: "enabled",
    async sendTranscript() {
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "what is the status okay send", final: false, finalTranscript: "" });
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

test("voice loop waits for the ok send phrase before sending captured text", async () => {
  const sent: string[] = [];
  const recognizer = fakeRecognizer();
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker([]),
    now: () => 1,
    minReadbackDelayMs: 0,
    submitMode: "send-phrase",
    readbackMode: "enabled",
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "draft prompt", final: false, finalTranscript: "" });
  await Promise.resolve();

  expect(sent).toEqual([]);
  expect(loop.state).toMatchObject({
    status: "listening",
    transcript: "draft prompt",
  });

  recognizer.emit({ transcript: "draft prompt ok send", final: false, finalTranscript: "" });
  await Promise.resolve();

  expect(sent).toEqual(["draft prompt"]);
  expect(loop.state).toMatchObject({
    status: "idle",
    transcript: "draft prompt",
  });
});

test("continuous voice loop sends finalized speech segments without a send phrase", async () => {
  const sent: string[] = [];
  const spoken: string[] = [];
  const recognizer = fakeRecognizer("Realtime");
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => 1,
    minReadbackDelayMs: 0,
    submitMode: "continuous",
    readbackMode: "disabled",
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "draft prompt", final: false, finalTranscript: "" });
  await Promise.resolve();

  expect(sent).toEqual([]);
  expect(loop.state).toMatchObject({
    status: "listening",
    transcript: "draft prompt",
    awaitingReadback: false,
  });

  recognizer.emit({ transcript: "draft prompt", final: true, finalTranscript: "draft prompt" });
  await flushVoiceQueue();

  expect(sent).toEqual(["draft prompt"]);
  expect(spoken).toEqual([]);
  expect(loop.state).toMatchObject({
    status: "listening",
    awaitingReadback: false,
  });

  recognizer.emit({ transcript: "draft prompt next prompt", final: true, finalTranscript: "next prompt" });
  await flushVoiceQueue();

  expect(sent).toEqual(["draft prompt", "next prompt"]);
  expect(loop.state.message).toContain("Listening continuously");
});

test("continuous readback mode ignores normal speech while busy and accepts silence commands", async () => {
  let now = Date.parse("2026-05-11T10:00:00.000Z");
  const sent: string[] = [];
  const spoken: string[] = [];
  const recognizer = fakeRecognizer("Realtime");
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => now,
    minReadbackDelayMs: 0,
    submitMode: "continuous",
    readbackMode: "enabled",
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "first prompt", final: true, finalTranscript: "first prompt" });
  await flushVoiceQueue();

  expect(sent).toEqual(["first prompt"]);
  expect(spoken).toEqual([]);
  expect(loop.state).toMatchObject({
    awaitingReadback: true,
  });

  loop.observePayload({
    id: "session-1",
    status: "busy",
    updatedAt: "2026-05-11T10:00:01.000Z",
    renderedText: "working",
    sdk: {
      provider: "codex",
      summary: null,
    },
  });
  recognizer.emit({ transcript: "do not send this", final: true, finalTranscript: "do not send this" });
  await flushVoiceQueue();

  expect(sent).toEqual(["first prompt"]);
  expect(loop.state.message).toContain("Listening for silence commands");

  recognizer.emit({ transcript: "silence", final: true, finalTranscript: "silence" });
  await flushVoiceQueue();
  now += 1_000;
  loop.observePayload({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:02.000Z",
    renderedText: "",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "first prompt",
        latestAssistantText: "answer that should stay silent",
        transcript: [
          message("user", "first prompt", "2026-05-11T10:00:00.100Z"),
          message("assistant", "answer that should stay silent", "2026-05-11T10:00:02.000Z"),
        ],
      },
    },
  });

  expect(spoken).toEqual(["[stop]"]);

  recognizer.emit({ transcript: "second prompt", final: true, finalTranscript: "second prompt" });
  await flushVoiceQueue();

  expect(sent).toEqual(["first prompt", "second prompt"]);
});

test("continuous readback mode only resumes normal input after speech ends or is interrupted", async () => {
  let now = Date.parse("2026-05-11T10:00:00.000Z");
  const sent: string[] = [];
  const spoken: string[] = [];
  const recognizer = fakeRecognizer("Realtime");
  const speaker = fakeSpeaker(spoken, { autoEnd: false });
  const loop = createVoiceLoop({
    recognizer,
    speaker,
    now: () => now,
    minReadbackDelayMs: 0,
    submitMode: "continuous",
    readbackMode: "enabled",
    async sendTranscript(text) {
      sent.push(text);
    },
  });

  loop.startListening();
  recognizer.emit({ transcript: "first prompt", final: true, finalTranscript: "first prompt" });
  await flushVoiceQueue();
  now += 1_000;
  loop.observePayload({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:02.000Z",
    renderedText: "",
    sdk: {
      provider: "codex",
      summary: {
        latestUserText: "first prompt",
        latestAssistantText: "spoken answer",
        transcript: [
          message("user", "first prompt", "2026-05-11T10:00:00.100Z"),
          message("assistant", "spoken answer", "2026-05-11T10:00:02.000Z"),
        ],
      },
    },
  });

  expect(spoken).toEqual(["spoken answer"]);
  expect(loop.state).toMatchObject({
    status: "speaking",
  });

  recognizer.emit({ transcript: "do not send while speaking", final: true, finalTranscript: "do not send while speaking" });
  await flushVoiceQueue();
  expect(sent).toEqual(["first prompt"]);

  recognizer.emit({ transcript: "shut up", final: true, finalTranscript: "shut up" });
  await flushVoiceQueue();
  expect(spoken).toEqual(["spoken answer", "[stop]"]);
  expect(loop.state.message).toContain("Listening continuously");

  recognizer.emit({ transcript: "second prompt", final: true, finalTranscript: "second prompt" });
  await flushVoiceQueue();
  expect(sent).toEqual(["first prompt", "second prompt"]);
});

test("voice send phrase strips ok send variants", () => {
  expect(voiceSendTextFromTranscript("check status ok send")).toBe("check status");
  expect(voiceSendTextFromTranscript("check status okay, send")).toBe("check status");
  expect(voiceSendTextFromTranscript("check status")).toBe("");
});

test("voice interrupt phrase detects silence commands", () => {
  expect(voiceInterruptTextFromTranscript("please shut up now")).toBe("shut up");
  expect(voiceInterruptTextFromTranscript("silence")).toBe("silence");
  expect(voiceInterruptTextFromTranscript("send this to the agent")).toBe("");
});

test("voice loop can be tested without a microphone or system speech", () => {
  const spoken: string[] = [];
  const recognizer = fakeRecognizer();
  const loop = createVoiceLoop({
    recognizer,
    speaker: fakeSpeaker(spoken),
    now: () => 1,
    minReadbackDelayMs: 0,
    submitMode: "send-phrase",
    readbackMode: "enabled",
    async sendTranscript() {
      throw new Error("cancelled transcripts should not send");
    },
  });

  loop.startListening();
  loop.cancelListening();
  recognizer.emit({ transcript: "ignore this", final: true, finalTranscript: "ignore this" });

  expect(spoken).toEqual([]);
  expect(loop.state).toMatchObject({
    status: "idle",
    message: "Listening cancelled",
  });
});

test("voice recognizer falls back when realtime setup fails before transcription", () => {
  const primary = fakeRecognizer("Realtime");
  const fallback = fakeRecognizer("browser");
  const recognizer = createFallbackVoiceRecognizer(primary, fallback);
  const results: Array<{ transcript: string; final: boolean; finalTranscript: string }> = [];
  const errors: string[] = [];

  recognizer.start({
    onResult(result) {
      results.push(result);
    },
    onError(message) {
      errors.push(message);
    },
    onEnd() {
    },
  });

  primary.fail("OPENAI_API_KEY is not configured");
  fallback.emit({ transcript: "tell codex to check the PR", final: true, finalTranscript: "tell codex to check the PR" });

  expect(errors).toEqual([]);
  expect(results).toEqual([
    { transcript: "tell codex to check the PR", final: true, finalTranscript: "tell codex to check the PR" },
  ]);
  expect(recognizer).toMatchObject({
    supported: true,
    label: "Realtime, browser fallback",
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

test("readback removes OpenCode step markers from provider text", () => {
  expect(createReadbackText({
    id: "session-1",
    status: "idle",
    updatedAt: "2026-05-11T10:00:00.000Z",
    renderedText: "",
    sdk: {
      provider: "opencode",
      summary: {
        latestAssistantText: [
          "[step-start]",
          "[reasoning]",
          "You're right.",
          "",
          "Hello. How may I help you today?",
          "[step-finish]",
        ].join("\n"),
      },
    },
  })).toBe("You're right. Hello. How may I help you today?");
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

function fakeRecognizer(label = "browser") {
  let handlers: Parameters<VoiceRecognizer["start"]>[0] | null = null;
  const recognizer: VoiceRecognizer & {
    emit: (result: { transcript: string; final: boolean; finalTranscript: string }) => void;
    fail: (message: string) => void;
  } = {
    supported: true,
    label,
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
    fail(message) {
      handlers?.onError(message);
    },
  };
  return recognizer;
}

function fakeSpeaker(spoken: string[], options: { autoEnd?: boolean } = {}): VoiceSpeaker & { end: () => void } {
  let onEnd: (() => void) | null = null;
  return {
    supported: true,
    speak(text, events) {
      spoken.push(text);
      onEnd = events?.onEnd || null;
      if (options.autoEnd !== false) {
        onEnd?.();
        onEnd = null;
      }
    },
    stop() {
      spoken.push("[stop]");
      onEnd = null;
    },
    end() {
      onEnd?.();
      onEnd = null;
    },
  };
}

async function flushVoiceQueue() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}
