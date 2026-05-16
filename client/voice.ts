export type VoiceSessionPayload = {
  id: string;
  status: "busy" | "idle" | "exited";
  updatedAt: string;
  renderedText: string;
  sdk: {
    provider: "" | "opencode" | "codex" | "claude";
    summary: null | {
      latestUserText?: string;
      latestAssistantText: string;
      transcript?: VoiceTranscriptMessage[];
    };
  };
};

export type VoiceTranscriptMessage = {
  role: string;
  createdAt: string;
  text: string;
};

export type VoiceRecognitionResult = {
  transcript: string;
  final: boolean;
  finalTranscript: string;
};

export type VoiceRecognizer = {
  supported: boolean;
  label?: string;
  start: (handlers: {
    onResult: (result: VoiceRecognitionResult) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }) => void;
  stop: () => void;
  cancel: () => void;
};

export type VoiceSpeaker = {
  supported: boolean;
  speak: (text: string, events?: { onEnd: () => void }) => void;
  stop: () => void;
};

export type VoiceLoopState = {
  status: "unsupported" | "idle" | "listening" | "transcribing" | "speaking" | "error";
  transcript: string;
  message: string;
  providerLabel: string;
  awaitingReadback: boolean;
};

export type VoiceLoop = {
  state: VoiceLoopState;
  startListening: () => void;
  stopListening: () => void;
  cancelListening: () => void;
  stopSpeaking: () => void;
  observePayload: (payload: VoiceSessionPayload) => void;
  subscribe: (listener: (state: VoiceLoopState) => void) => () => void;
};

export type VoiceSubmitMode = "send-phrase" | "continuous";
export type VoiceReadbackMode = "enabled" | "disabled";

export function createVoiceLoop(input: {
  recognizer: VoiceRecognizer;
  speaker: VoiceSpeaker;
  sendTranscript: (text: string) => Promise<void>;
  now: () => number;
  minReadbackDelayMs: number;
  submitMode: VoiceSubmitMode;
  readbackMode: VoiceReadbackMode;
}) {
  const listeners = new Set<(state: VoiceLoopState) => void>();
  const providerLabel = input.recognizer.label || "browser";
  const recognizerSupported = input.recognizer.supported;
  const speakerSupported = input.readbackMode === "disabled" || input.speaker.supported;
  const unsupportedMessage = recognizerSupported
    ? "Voice readback requires speech synthesis support"
    : "Voice capture requires HTTPS and microphone support";
  const state: VoiceLoopState = {
    status: recognizerSupported && speakerSupported ? "idle" : "unsupported",
    transcript: "",
    providerLabel,
    message: recognizerSupported && speakerSupported
      ? `Voice ready (${providerLabel})`
      : unsupportedMessage,
    awaitingReadback: false,
  };
  let pendingSessionId = "";
  let promptSentAt = 0;
  let promptPayloadUpdatedAt = "";
  let readbackSpokenFor = "";
  let cancelled = false;
  let ignoreRecognizerEvents = false;
  let listening = false;
  let sendQueue = Promise.resolve();
  let observedSessionStatus: VoiceSessionPayload["status"] = "idle";
  let speakingReadback = false;

  function emit() {
    for (const listener of listeners) {
      listener({ ...state });
    }
  }

  function readyMessage() {
    return `Voice ready (${providerLabel})`;
  }

  function listeningMessage() {
    if (listensForInterruptsOnly()) {
      return `Listening for silence commands (${providerLabel})`;
    }
    return input.submitMode === "continuous"
      ? `Listening continuously (${providerLabel}); pause to send`
      : `Listening (${providerLabel}); say ok send to send`;
  }

  function listensForInterruptsOnly() {
    return input.submitMode === "continuous"
      && input.readbackMode === "enabled"
      && (state.awaitingReadback || speakingReadback || observedSessionStatus === "busy");
  }

  function handleInterruptTranscript(transcript: string) {
    if (!voiceInterruptTextFromTranscript(transcript)) {
      return false;
    }
    input.speaker.stop();
    speakingReadback = false;
    state.awaitingReadback = false;
    state.status = listening ? "listening" : "idle";
    state.message = listening ? listeningMessage() : "Speech stopped";
    emit();
    return true;
  }

  async function acceptTranscript(transcript: string) {
    const text = transcript.trim();
    if (!text || cancelled) {
      state.status = "idle";
      state.message = text
        ? input.submitMode === "continuous" ? "Voice mode stopped" : "Listening cancelled"
        : "No speech detected";
      emit();
      return;
    }
    state.status = input.readbackMode === "enabled" ? "speaking" : "transcribing";
    state.transcript = text;
    state.message = input.submitMode === "continuous" ? "Sending voice segment" : "Sending voice prompt";
    state.awaitingReadback = input.readbackMode === "enabled";
    if (input.readbackMode === "enabled") {
      pendingSessionId = "";
      promptSentAt = input.now();
      promptPayloadUpdatedAt = "";
      readbackSpokenFor = "";
    }
    emit();
    await input.sendTranscript(text);
    if (input.readbackMode === "enabled") {
      if (input.submitMode !== "continuous") {
        input.speaker.speak(createAcknowledgement(text));
      }
      state.status = listening ? "listening" : "idle";
      state.message = "Voice prompt sent";
      emit();
      return;
    }
    state.status = listening ? "listening" : "idle";
    state.message = listening ? listeningMessage() : "Voice segment sent";
    emit();
  }

  function queueContinuousTranscript(transcript: string) {
    const text = transcript.trim();
    if (!text || cancelled) {
      return;
    }
    sendQueue = sendQueue
      .then(() => acceptTranscript(text))
      .catch((error) => {
        listening = false;
        input.recognizer.cancel();
        state.status = "error";
        state.message = String(error instanceof Error ? error.message : error);
        state.awaitingReadback = false;
        emit();
      });
  }

  function startRecognizer() {
    input.recognizer.start({
      onResult(result) {
        if (ignoreRecognizerEvents || cancelled) {
          return;
        }
        if (input.submitMode === "continuous") {
          state.transcript = result.transcript;
          if (listensForInterruptsOnly()) {
            state.status = speakingReadback ? "speaking" : "listening";
            state.message = listeningMessage();
            emit();
            if (result.final) {
              handleInterruptTranscript(result.finalTranscript || result.transcript);
            }
            return;
          }
          state.status = result.final && result.finalTranscript.trim() ? "transcribing" : "listening";
          state.message = state.status === "transcribing" ? "Sending voice segment" : listeningMessage();
          emit();
          if (result.final) {
            queueContinuousTranscript(result.finalTranscript);
          }
          return;
        }

        const sendText = voiceSendTextFromTranscript(result.transcript);
        state.transcript = sendText || result.transcript;
        state.status = sendText ? "transcribing" : "listening";
        state.message = sendText ? "Sending voice prompt" : listeningMessage();
        emit();
        if (sendText) {
          ignoreRecognizerEvents = true;
          listening = false;
          input.recognizer.cancel();
          void acceptTranscript(sendText).catch((error) => {
            state.status = "error";
            state.message = String(error instanceof Error ? error.message : error);
            state.awaitingReadback = false;
            emit();
          });
        }
      },
      onError(message) {
        if (ignoreRecognizerEvents || cancelled) {
          return;
        }
        listening = false;
        state.status = "error";
        state.message = message;
        state.awaitingReadback = false;
        emit();
      },
      onEnd() {
        if (ignoreRecognizerEvents || cancelled) {
          return;
        }
        if (input.submitMode === "continuous" && listening) {
          state.status = "listening";
          state.message = "Restarting voice capture";
          emit();
          startRecognizer();
          return;
        }
        if (state.status === "listening") {
          listening = false;
          state.status = "idle";
          state.message = state.transcript ? "Say ok send to send" : readyMessage();
          emit();
        }
      },
    });
  }

  const loop: VoiceLoop = {
    state,
    startListening() {
      if (!recognizerSupported || !speakerSupported) {
        state.status = "unsupported";
        state.message = unsupportedMessage;
        emit();
        return;
      }
      cancelled = false;
      ignoreRecognizerEvents = false;
      listening = true;
      state.status = "listening";
      state.transcript = "";
      state.message = listeningMessage();
      emit();
      startRecognizer();
    },
    stopListening() {
      if (listening || state.status === "listening" || state.status === "transcribing") {
        cancelled = true;
        listening = false;
        input.recognizer.cancel();
        state.status = "idle";
        state.message = input.submitMode === "continuous" ? "Voice mode stopped" : "Listening cancelled";
        emit();
      }
    },
    cancelListening() {
      cancelled = true;
      listening = false;
      input.recognizer.cancel();
      state.status = "idle";
      state.message = input.submitMode === "continuous" ? "Voice mode stopped" : "Listening cancelled";
      emit();
    },
    stopSpeaking() {
      input.speaker.stop();
      speakingReadback = false;
      state.awaitingReadback = false;
      state.status = listening ? "listening" : "idle";
      state.message = listening ? listeningMessage() : "Speech stopped";
      emit();
    },
    observePayload(payload) {
      observedSessionStatus = payload.status;
      if (input.readbackMode === "disabled") {
        return;
      }
      if (!state.awaitingReadback) {
        return;
      }
      if (!pendingSessionId) {
        pendingSessionId = payload.id;
        promptPayloadUpdatedAt = payload.updatedAt;
      }
      if (payload.id !== pendingSessionId) {
        return;
      }
      if (payload.status !== "idle" || input.now() - promptSentAt < input.minReadbackDelayMs) {
        return;
      }
      if (payload.updatedAt === promptPayloadUpdatedAt && !payload.sdk.summary?.latestAssistantText) {
        return;
      }
      const text = createReadbackText(payload, {
        promptSentAt,
        promptText: state.transcript,
      });
      if (!text || readbackSpokenFor === `${payload.updatedAt}:${text}`) {
        return;
      }
      readbackSpokenFor = `${payload.updatedAt}:${text}`;
      state.awaitingReadback = false;
      speakingReadback = true;
      state.status = "speaking";
      state.message = "Reading result";
      emit();
      input.speaker.speak(text, {
        onEnd() {
          if (!speakingReadback) {
            return;
          }
          speakingReadback = false;
          state.status = listening ? "listening" : "idle";
          state.message = listening ? listeningMessage() : "Readback complete";
          emit();
        },
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return loop;
}

export function voiceSendTextFromTranscript(transcript: string) {
  const match = transcript.match(/\b(?:ok|okay)[,.\s]+send\b/i);
  if (!match || match.index === undefined) {
    return "";
  }
  return transcript.slice(0, match.index).trim().replace(/[,\s]+$/, "");
}

export function voiceInterruptTextFromTranscript(transcript: string) {
  const text = transcript.trim();
  if (!text) {
    return "";
  }
  const match = text.match(/\b(?:shut up|silence|stop talking|stop speaking|quiet)\b/i);
  return match?.[0] || "";
}

export function createBrowserVoiceRecognizer(): VoiceRecognizer {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  let recognition: any = null;
  let lastFinalTranscript = "";
  return {
    supported: Boolean(SpeechRecognition),
    label: "browser",
    start(handlers) {
      if (!SpeechRecognition) {
        handlers.onError("Speech recognition is not supported in this browser");
        return;
      }
      lastFinalTranscript = "";
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event: any) => {
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result?.[0]?.transcript || "").trim();
          if (!text) {
            continue;
          }
          if (result?.isFinal) {
            finalParts.push(text);
          } else {
            interimParts.push(text);
          }
        }
        const finalTranscript = finalParts.join(" ").trim();
        const transcript = [...finalParts, ...interimParts].join(" ").trim();
        const nextFinalTranscript = finalTranscript && finalTranscript !== lastFinalTranscript
          ? transcriptSuffix(finalTranscript, lastFinalTranscript)
          : "";
        if (nextFinalTranscript) {
          lastFinalTranscript = finalTranscript;
        }
        handlers.onResult({
          transcript,
          final: Boolean(nextFinalTranscript),
          finalTranscript: nextFinalTranscript,
        });
      };
      recognition.onerror = (event: any) => {
        handlers.onError(String(event.error || "Speech recognition failed"));
      };
      recognition.onend = () => {
        handlers.onEnd();
      };
      recognition.start();
    },
    stop() {
      recognition?.stop();
    },
    cancel() {
      recognition?.abort();
      recognition = null;
    },
  };
}

function transcriptSuffix(transcript: string, previousTranscript: string) {
  const text = transcript.trim();
  const previous = previousTranscript.trim();
  if (!previous) {
    return text;
  }
  if (!text.toLowerCase().startsWith(previous.toLowerCase())) {
    return text;
  }
  return text.slice(previous.length).trim();
}

export function createPreferredBrowserVoiceRecognizer(): VoiceRecognizer {
  return createFallbackVoiceRecognizer(
    createRealtimeTranscriptionVoiceRecognizer({
      endpoint: "/api/voice/realtime-transcription/sdp",
      fetchImpl: window.fetch.bind(window),
      mediaDevices: navigator.mediaDevices,
      PeerConnection: window.RTCPeerConnection,
    }),
    createBrowserVoiceRecognizer(),
  );
}

export function createFallbackVoiceRecognizer(primary: VoiceRecognizer, fallback: VoiceRecognizer): VoiceRecognizer {
  let active: VoiceRecognizer = primary.supported ? primary : fallback;
  return {
    supported: primary.supported || fallback.supported,
    label: primary.supported && fallback.supported ? `${primary.label || "primary"}, ${fallback.label || "fallback"} fallback` : active.label,
    start(handlers) {
      if (!primary.supported) {
        active = fallback;
        fallback.start(handlers);
        return;
      }
      active = primary;
      let emittedResult = false;
      primary.start({
        onResult(result) {
          emittedResult = true;
          handlers.onResult(result);
        },
        onError(message) {
          if (!emittedResult && fallback.supported) {
            active = fallback;
            fallback.start(handlers);
            return;
          }
          handlers.onError(message);
        },
        onEnd() {
          handlers.onEnd();
        },
      });
    },
    stop() {
      active.stop();
    },
    cancel() {
      active.cancel();
    },
  };
}

export function createRealtimeTranscriptionVoiceRecognizer(input: {
  endpoint: string;
  fetchImpl: typeof fetch;
  mediaDevices: MediaDevices | undefined;
  PeerConnection: typeof RTCPeerConnection | undefined;
}): VoiceRecognizer {
  let session: RealtimeTranscriptionBrowserSession | null = null;
  const supported = Boolean(input.PeerConnection && input.mediaDevices?.getUserMedia);
  return {
    supported,
    label: "Realtime",
    start(handlers) {
      const mediaDevices = input.mediaDevices;
      const PeerConnection = input.PeerConnection;
      if (!supported || !PeerConnection || !mediaDevices) {
        handlers.onError("Realtime transcription is not supported in this browser");
        return;
      }
      const nextSession: RealtimeTranscriptionBrowserSession = {
        cancelled: false,
        transcript: "",
        itemTranscripts: new Map(),
        itemOrder: [],
        stream: null,
        pc: null,
        dc: null,
      };
      session = nextSession;
      void startRealtimeTranscription({
        endpoint: input.endpoint,
        fetchImpl: input.fetchImpl,
        mediaDevices,
        PeerConnection,
      }, nextSession, handlers).catch((error) => {
        closeRealtimeTranscriptionSession(nextSession);
        if (!nextSession.cancelled) {
          handlers.onError(String(error instanceof Error ? error.message : error));
        }
      });
    },
    stop() {
      if (!session) {
        return;
      }
      if (session.dc?.readyState === "open") {
        session.dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }
      for (const track of session.stream?.getTracks() || []) {
        track.stop();
      }
    },
    cancel() {
      if (!session) {
        return;
      }
      session.cancelled = true;
      closeRealtimeTranscriptionSession(session);
      session = null;
    },
  };
}

type RealtimeTranscriptionBrowserSession = {
  cancelled: boolean;
  transcript: string;
  itemTranscripts: Map<string, string>;
  itemOrder: string[];
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
};

async function startRealtimeTranscription(
  input: {
    endpoint: string;
    fetchImpl: typeof fetch;
    mediaDevices: MediaDevices;
    PeerConnection: typeof RTCPeerConnection;
  },
  session: RealtimeTranscriptionBrowserSession,
  handlers: Parameters<VoiceRecognizer["start"]>[0],
) {
  const pc = new input.PeerConnection();
  session.pc = pc;
  session.stream = await input.mediaDevices.getUserMedia({ audio: true });
  for (const track of session.stream.getTracks()) {
    pc.addTrack(track, session.stream);
  }
  const dc = pc.createDataChannel("oai-events");
  session.dc = dc;
  dc.addEventListener("message", (event) => {
    handleRealtimeTranscriptionEvent(session, handlers, String(event.data || ""));
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const offerSdp = offer.sdp || pc.localDescription?.sdp || "";
  const response = await input.fetchImpl(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
    },
    body: offerSdp,
  });
  const answerSdp = await response.text();
  if (!response.ok) {
    throw new Error(answerSdp || `Realtime transcription setup failed (${response.status})`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

function handleRealtimeTranscriptionEvent(
  session: RealtimeTranscriptionBrowserSession,
  handlers: Parameters<VoiceRecognizer["start"]>[0],
  rawEvent: string,
) {
  const event = parseRealtimeEvent(rawEvent);
  if (!event || session.cancelled) {
    return;
  }
  if (event.type === "conversation.item.input_audio_transcription.delta") {
    const itemId = String(event.item_id || "current");
    updateRealtimeItemTranscript(session, itemId, `${session.itemTranscripts.get(itemId) || ""}${String(event.delta || "")}`);
    handlers.onResult({ transcript: session.transcript, final: false, finalTranscript: "" });
    return;
  }
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    const itemId = String(event.item_id || "current");
    const finalTranscript = String(event.transcript || session.itemTranscripts.get(itemId) || "").trim();
    updateRealtimeItemTranscript(session, itemId, finalTranscript);
    handlers.onResult({ transcript: session.transcript, final: true, finalTranscript });
    return;
  }
  if (event.type === "error") {
    closeRealtimeTranscriptionSession(session);
    handlers.onError(String(event.error?.message || "Realtime transcription failed"));
  }
}

function updateRealtimeItemTranscript(session: RealtimeTranscriptionBrowserSession, itemId: string, transcript: string) {
  if (!session.itemTranscripts.has(itemId)) {
    session.itemOrder.push(itemId);
  }
  session.itemTranscripts.set(itemId, transcript.trim());
  session.transcript = session.itemOrder
    .map((id) => session.itemTranscripts.get(id) || "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

function parseRealtimeEvent(rawEvent: string): any {
  try {
    return JSON.parse(rawEvent);
  } catch {
    return null;
  }
}

function closeRealtimeTranscriptionSession(session: RealtimeTranscriptionBrowserSession) {
  for (const track of session.stream?.getTracks() || []) {
    track.stop();
  }
  session.stream = null;
  session.dc?.close();
  session.dc = null;
  session.pc?.close();
  session.pc = null;
}

export function createBrowserVoiceSpeaker(): VoiceSpeaker {
  return {
    supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    speak(text, events) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => events?.onEnd();
      utterance.onerror = () => events?.onEnd();
      window.speechSynthesis.speak(utterance);
    },
    stop() {
      window.speechSynthesis.cancel();
    },
  };
}

export function createAcknowledgement(transcript: string) {
  const preview = transcript.trim().replace(/\s+/g, " ").slice(0, 90);
  return `Sent: ${preview}. I'll read back when the session is idle.`;
}

export function createReadbackText(
  payload: VoiceSessionPayload,
  freshness?: { promptSentAt: number; promptText: string },
) {
  const sdkText = createSdkReadbackText(payload, freshness);
  if (sdkText) {
    return sdkText;
  }
  if (payload.sdk.provider) {
    return "";
  }
  const visible = payload.renderedText
    .split("\n")
    .map(cleanTerminalReadbackLine)
    .filter(Boolean)
    .slice(-4)
    .join(". ");
  return shortenForSpeech(visible);
}

function createSdkReadbackText(
  payload: VoiceSessionPayload,
  freshness?: { promptSentAt: number; promptText: string },
) {
  const summary = payload.sdk.summary;
  if (!summary) {
    return "";
  }
  const summaryText = cleanProviderReadbackText(summary.latestAssistantText);
  if (!summaryText) {
    return "";
  }
  if (!freshness) {
    return shortenForSpeech(summaryText);
  }

  const assistant = freshAssistantMessageForPrompt(summary.transcript || [], freshness);
  return assistant ? shortenForSpeech(cleanProviderReadbackText(assistant.text)) : "";
}

function freshAssistantMessageForPrompt(
  transcript: VoiceTranscriptMessage[],
  freshness: { promptSentAt: number; promptText: string },
) {
  const prompt = normalizeFreshnessText(freshness.promptText);
  if (!prompt) {
    return null;
  }

  const latestPromptIndex = transcript.findLastIndex((message) => {
    return message.role === "user" && normalizeFreshnessText(message.text) === prompt;
  });
  if (latestPromptIndex < 0) {
    return null;
  }

  const user = transcript[latestPromptIndex]!;
  const assistantIndex = transcript.findLastIndex((message, index) => {
    return index > latestPromptIndex && message.role === "assistant" && Boolean(message.text.trim());
  });
  if (assistantIndex < 0) {
    return null;
  }

  const assistant = transcript[assistantIndex]!;
  if (!messageTimestampMakesSense(user, assistant, freshness.promptSentAt)) {
    return null;
  }
  return assistant;
}

function messageTimestampMakesSense(
  user: VoiceTranscriptMessage,
  assistant: VoiceTranscriptMessage,
  promptSentAt: number,
) {
  const userMs = Date.parse(user.createdAt);
  const assistantMs = Date.parse(assistant.createdAt);
  if (!Number.isFinite(userMs) || !Number.isFinite(assistantMs)) {
    return false;
  }

  const timestampToleranceMs = 1_500;
  return userMs >= promptSentAt - timestampToleranceMs
    && assistantMs >= userMs - timestampToleranceMs;
}

function normalizeFreshnessText(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanProviderReadbackText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !/^\[(step-start|step-finish|reasoning)\]$/i.test(line))
    .join("\n")
    .trim();
}

function cleanTerminalReadbackLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || /^[╭╮╯╰─│┌┐└┘═║╔╗╚╝\s]+$/.test(trimmed)) {
    return "";
  }
  return trimmed
    .replace(/^[│║]\s*/, "")
    .replace(/\s*[│║]$/, "")
    .trim();
}

function shortenForSpeech(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 420) {
    return normalized;
  }
  return `${normalized.slice(0, 417).trim()}...`;
}
