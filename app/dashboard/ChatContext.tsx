"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { speakableText } from "@/lib/speech-text";
import { useDictation, useSpeaker, type Dictation, type Speaker } from "./useSpeech";
import type { OrbMode } from "../Orb";

// The assistant's state, held once for every signed-in page.
//
// It used to live inside ChatSection, which meant every time that
// component unmounted the conversation went with it — opening the
// morning brief on Home swaps the big assistant for the slim bar (a
// different element), and switching to Email or Calendar does the same.
// Either one silently wiped whatever you'd been talking about. Held here,
// above all of those, the transcript, the half-typed question, the mic
// and the voice all survive moving around the app.

export type PerformedAction = {
  id: string;
  summary: string;
  undoable: boolean;
  undone?: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Epoch ms, client clock. Only ever used for the timestamp label. */
  at: number;
  // What the assistant actually changed on this turn. Attached to the
  // message so the receipt stays next to the sentence that claimed it.
  actions?: PerformedAction[];
};

export type ChatStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

export type ChatMode = "voice" | "text";

type ChatContextValue = {
  messages: ChatMessage[];
  input: string;
  setInput: (text: string) => void;
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  status: ChatStatus;
  sending: boolean;
  orbMode: OrbMode;
  voiceReplies: boolean;
  toggleVoiceReplies: () => void;
  dictation: Dictation;
  speaker: Speaker;
  send: (text: string) => Promise<void>;
  undoAction: (messageId: string, actionId: string) => Promise<void>;
  undoing: string | null;
  clearConversation: () => void;
  dismissError: () => void;
  lastAssistant: ChatMessage | undefined;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useChat must be used inside <ChatProvider>");
  }
  return value;
}

let nextId = 0;
const newId = () => `m${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setModeState] = useState<ChatMode>("voice");
  const [status, setStatus] = useState<ChatStatus>({ kind: "idle" });
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);

  // Dictation writes into the same input box typing does, so a misheard
  // "archive the newsletters" sits in an editable box until Send.
  const handleTranscript = useCallback((text: string) => setInput(text), []);
  const dictation = useDictation(handleTranscript);
  const stopDictation = dictation.stop;

  const speaker = useSpeaker();
  const { speak, cancel: cancelSpeech, prime: primeSpeech } = speaker;
  // Id of the last message read aloud, so a re-render (undoing an action,
  // say) doesn't make Nexus repeat itself.
  const lastSpokenRef = useRef<string | null>(null);

  // Muted is the default, and a failed read stays muted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          profile: { voice_replies?: boolean | null } | null;
        };
        if (!cancelled && body.profile?.voice_replies === true) {
          setVoiceReplies(true);
        }
      } catch {
        /* stay muted */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voiceReplies) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenRef.current === last.id) return;
    lastSpokenRef.current = last.id;
    speak(speakableText(last.content));
  }, [messages, voiceReplies, speak]);

  const toggleVoiceReplies = useCallback(() => {
    const next = !voiceReplies;
    setVoiceReplies(next);
    // Turning it on shouldn't read out the answer already on screen.
    lastSpokenRef.current = messages[messages.length - 1]?.id ?? null;
    if (next) primeSpeech();
    else cancelSpeech();

    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: { voice_replies: next } }),
    }).catch(() => {
      // Still works for this session; just won't follow them elsewhere.
    });
  }, [voiceReplies, messages, primeSpeech, cancelSpeech]);

  const setMode = useCallback(
    (next: ChatMode) => {
      if (next === "text") stopDictation();
      // A tap on Voice counts as the user gesture iOS wants before it
      // will synthesise speech later on.
      if (next === "voice") primeSpeech();
      setModeState(next);
    },
    [stopDictation, primeSpeech]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status.kind === "sending") return;

      stopDictation();

      const previous = messages;
      const next: ChatMessage[] = [
        ...messages,
        { id: newId(), role: "user", content: trimmed, at: Date.now() },
      ];
      setMessages(next);
      setInput("");
      setStatus({ kind: "sending" });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          // The API validates a strict {role, content} shape.
          body: JSON.stringify({
            messages: next.map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body?.code === "not_connected" || body?.code === "reauth_required") {
            setMessages(previous);
            setInput(trimmed);
            setStatus({ kind: "disconnected" });
            return;
          }
          throw new Error(body?.error ?? "Couldn't answer that just now.");
        }

        const body = (await res.json()) as {
          reply: { role: "assistant"; content: string };
          actions?: PerformedAction[];
        };
        setMessages([
          ...next,
          {
            id: newId(),
            role: "assistant",
            content: body.reply?.content ?? "",
            at: Date.now(),
            actions: body.actions ?? [],
          },
        ]);
        setStatus({ kind: "idle" });
      } catch (err) {
        // Drop the unanswered question back into the input so it isn't lost.
        setMessages(previous);
        setInput(trimmed);
        setStatus({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Couldn't answer that just now.",
        });
      }
    },
    [messages, status.kind, stopDictation]
  );

  // Undo state lives on the message rather than in the receipt component,
  // so an undone action still reads as undone after the chat re-renders
  // in a different layout.
  const undoAction = useCallback(async (messageId: string, actionId: string) => {
    setUndoing(actionId);
    try {
      const res = await fetch(`/api/actions/${actionId}/undo`, { method: "POST" });
      if (!res.ok) return;
      setMessages((current) =>
        current.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                actions: m.actions?.map((a) =>
                  a.id === actionId ? { ...a, undone: true } : a
                ),
              }
        )
      );
    } catch {
      /* the button stays, so they can try again */
    } finally {
      setUndoing(null);
    }
  }, []);

  const clearConversation = useCallback(() => {
    cancelSpeech();
    stopDictation();
    setMessages([]);
    setInput("");
    setStatus((s) => (s.kind === "disconnected" ? s : { kind: "idle" }));
  }, [cancelSpeech, stopDictation]);

  const dismissError = useCallback(() => {
    setStatus((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, []);

  const sending = status.kind === "sending";

  // What the orb is doing, in priority order: the user talking beats us
  // talking beats us thinking.
  const orbMode: OrbMode = dictation.listening
    ? "listening"
    : speaker.speaking
      ? "speaking"
      : sending
        ? "thinking"
        : "idle";

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages]
  );

  const value: ChatContextValue = {
    messages,
    input,
    setInput,
    mode,
    setMode,
    status,
    sending,
    orbMode,
    voiceReplies,
    toggleVoiceReplies,
    dictation,
    speaker,
    send,
    undoAction,
    undoing,
    clearConversation,
    dismissError,
    lastAssistant,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
