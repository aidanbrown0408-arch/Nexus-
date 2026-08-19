"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CORE_SECTION,
  OPTIONAL_SECTIONS,
  type Question,
  type Section,
} from "@/lib/onboarding-questions";

// The interview, one question per screen.
//
// Structure mirrors ONBOARDING_INTERVIEW_PLAN.md: the core section runs
// for everyone, then a single offer screen, then whichever optional
// sections were picked, run back to back.
//
// Two decisions worth not undoing:
//
//   - Each answer is saved when you leave the question, not at the end. A
//     closed tab costs you the question you were on, nothing before it.
//   - A failed save doesn't block you. Onboarding is the worst possible
//     place to trap someone behind an error, and the profile is additive
//     — a missing field degrades the brief, it doesn't break it.

type Answers = Record<string, string | string[]>;

// Where we are: walking a section's questions, on the offer screen, or done.
type Step =
  | { kind: "questions"; section: Section; index: number }
  | { kind: "offer" };

export default function OnboardingFlow() {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState<Step>({
    kind: "questions",
    section: CORE_SECTION,
    index: 0,
  });
  // Optional sections the user opted into, in the order they'll be shown.
  const [queue, setQueue] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const save = useCallback(
    async (payload: {
      answers?: Answers;
      finish?: boolean;
      skip?: boolean;
    }) => {
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveFailed(false);
        return true;
      } catch {
        // Surfaced quietly at the bottom of the screen. See the note above
        // on why this doesn't stop the flow.
        setSaveFailed(true);
        return false;
      }
    },
    []
  );

  const leave = useCallback(
    async (payload: { finish?: boolean; skip?: boolean }) => {
      setSaving(true);
      await save(payload);
      // Full navigation rather than router.push: the dashboard is a server
      // component whose redirect reads the row we just wrote, and a soft
      // push can serve it from the client cache.
      window.location.href = "/dashboard";
    },
    [save]
  );

  // --- moving between screens ---------------------------------------

  const advance = useCallback(
    async (
      field: string | null,
      value: string | string[] | null,
      otherValue?: string
    ) => {
      // otherValue is threaded through as a parameter rather than read back
      // out of `answers` state. It used to be set via a separate setAnswers
      // call in QuestionScreen's onSubmit right before this ran — but React
      // batches that update, so the `answers` closure here could still be
      // one render behind and silently drop the "other" text on a sector
      // like "Nonprofit" that only exists in that companion field.
      const next = { ...answers };
      if (field) {
        if (value === null || (Array.isArray(value) && !value.length && field !== "news_preferences")) {
          delete next[field];
        } else {
          next[field] = value ?? "";
        }
      }

      const otherField =
        step.kind === "questions"
          ? step.section.questions[step.index]?.otherField
          : undefined;
      if (otherField && otherValue !== undefined) {
        next[otherField] = otherValue;
      }

      if (field || (otherField && otherValue !== undefined)) setAnswers(next);

      if (step.kind !== "questions") return;

      // Persist just this answer. Timezone rides along with the morning
      // question because the browser knows it and the user shouldn't have
      // to be asked.
      if (field) {
        const payload: Answers = { [field]: next[field] ?? "" };
        if (field === "morning_time") {
          payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        if (otherField && next[otherField] !== undefined) {
          payload[otherField] = next[otherField];
        }
        setSaving(true);
        await save({ answers: payload });
        setSaving(false);
      }

      const isLast = step.index === step.section.questions.length - 1;
      if (!isLast) {
        setStep({ ...step, index: step.index + 1 });
        return;
      }

      // End of a section. Core hands off to the offer screen; an optional
      // section hands off to the next one queued, or finishes.
      if (!step.section.optional) {
        setStep({ kind: "offer" });
        return;
      }

      const [next_, ...rest] = queue;
      if (next_) {
        setQueue(rest);
        setStep({ kind: "questions", section: next_, index: 0 });
      } else {
        await leave({ finish: true });
      }
    },
    [answers, step, queue, save, leave]
  );

  const back = useCallback(() => {
    if (step.kind !== "questions" || step.index === 0) return;
    setStep({ ...step, index: step.index - 1 });
  }, [step]);

  const startOptional = useCallback(
    async (sections: Section[]) => {
      if (!sections.length) {
        await leave({ finish: true });
        return;
      }
      const [first, ...rest] = sections;
      setQueue(rest);
      setStep({ kind: "questions", section: first, index: 0 });
    },
    [leave]
  );

  // --- render --------------------------------------------------------

  if (step.kind === "offer") {
    return (
      <Shell>
        <OfferScreen
          onPick={startOptional}
          onDone={() => leave({ finish: true })}
          busy={saving}
        />
        <SaveWarning visible={saveFailed} />
      </Shell>
    );
  }

  const question = step.section.questions[step.index];
  const total = step.section.questions.length;

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {step.section.optional ? step.section.title : "Getting set up"}
        </p>
        <p className="text-xs text-neutral-400">
          {step.index + 1} of {total}
        </p>
      </div>

      <div
        aria-hidden
        className="mb-8 h-1 w-full overflow-hidden rounded-full bg-neutral-100"
      >
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${((step.index + 1) / total) * 100}%` }}
        />
      </div>

      <QuestionScreen
        // Remounts on question change so local input state resets cleanly
        // instead of leaking the previous answer into the next field.
        key={question.field}
        question={question}
        initial={answers[question.field]}
        initialOther={
          question.otherField
            ? (answers[question.otherField] as string | undefined)
            : undefined
        }
        onSubmit={(value, other) => advance(question.field, value, other)}
        onSkip={() => advance(question.field, null)}
        onBack={step.index > 0 ? back : undefined}
        busy={saving}
      />

      <button
        type="button"
        onClick={() => leave({ skip: true })}
        className="mt-8 text-xs text-neutral-400 underline-offset-4 transition-colors hover:text-neutral-600 hover:underline"
      >
        Set this up later
      </button>

      <SaveWarning visible={saveFailed} />
    </Shell>
  );
}

// --- screens ---------------------------------------------------------

function QuestionScreen({
  question,
  initial,
  initialOther,
  onSubmit,
  onSkip,
  onBack,
  busy,
}: {
  question: Question;
  initial?: string | string[];
  initialOther?: string;
  onSubmit: (
    value: string | string[],
    other?: string
  ) => void | Promise<void>;
  onSkip: () => void;
  onBack?: () => void;
  busy: boolean;
}) {
  const [text, setText] = useState(
    typeof initial === "string" ? initial : ""
  );
  const [list, setList] = useState<string[]>(
    Array.isArray(initial) ? initial : []
  );
  const [other, setOther] = useState(initialOther ?? "");

  const value = useMemo(() => {
    if (question.kind === "list") {
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    if (question.kind === "multi") return list;
    return text;
  }, [question.kind, text, list]);

  const empty = Array.isArray(value) ? !value.length : !value.trim();
  // "None of these" is a real answer to the news question, so an empty
  // multi-select submits rather than being treated as a skip.
  const canSubmit = question.kind === "multi" || !empty;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value, question.otherField ? other : undefined);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold leading-snug text-neutral-900">
        {question.prompt}
      </h1>
      {question.help && (
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          {question.help}
        </p>
      )}

      <div className="mt-6">
        {question.kind === "text" && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={question.placeholder}
            className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-base text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
          />
        )}

        {question.kind === "time" && (
          <input
            autoFocus
            type="time"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base text-neutral-900 outline-none transition-colors focus:border-indigo-400"
          />
        )}

        {(question.kind === "textarea" || question.kind === "list") && (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={question.kind === "list" ? 4 : 3}
            placeholder={question.placeholder}
            className="w-full resize-none rounded-xl border border-neutral-200 px-4 py-3 text-base leading-relaxed text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
          />
        )}

        {question.kind === "choice" && (
          <div className="space-y-2">
            {(question.options ?? []).map((option) => {
              const selected = text === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setText(option.value)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    selected
                      ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                      : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                  {selected && <span aria-hidden>✓</span>}
                </button>
              );
            })}

            {question.otherField && text === "other" && (
              <input
                autoFocus
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="What field is it?"
                className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-base text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
              />
            )}
          </div>
        )}

        {question.kind === "multi" && (
          <div className="space-y-2">
            {(question.options ?? []).map((option) => {
              const selected = list.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setList((prev) =>
                      prev.includes(option.value)
                        ? prev.filter((v) => v !== option.value)
                        : [...prev, option.value]
                    )
                  }
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    selected
                      ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                      : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                  {selected && <span aria-hidden>✓</span>}
                </button>
              );
            })}
            <p className="pt-1 text-xs text-neutral-400">
              Pick any, or none — continue without selecting to skip news
              entirely.
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || busy}
          className="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : "Continue"}
        </button>

        {!empty ? null : (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-40"
          >
            Skip this one
          </button>
        )}

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="ml-auto text-sm text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-40"
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

function OfferScreen({
  onPick,
  onDone,
  busy,
}: {
  onPick: (sections: Section[]) => void;
  onDone: () => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );

  return (
    <div>
      <h1 className="text-2xl font-semibold leading-snug text-neutral-900">
        Want to tell Nexus a bit more?
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">
        Optional, and about two minutes. You already gave it enough to be
        useful.
      </p>

      <div className="mt-6 space-y-2">
        {OPTIONAL_SECTIONS.map((section) => {
          const selected = picked.includes(section.id);
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => toggle(section.id)}
              className={`flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              <span>
                <span
                  className={`block text-sm font-medium ${
                    selected ? "text-indigo-900" : "text-neutral-800"
                  }`}
                >
                  {section.title}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {section.pitch}
                </span>
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {section.questions.length} questions
                {selected ? " ✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onPick(OPTIONAL_SECTIONS.filter((s) => picked.includes(s.id)))
          }
          className="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {picked.length ? "Continue" : "Finish"}
        </button>
        {picked.length > 0 && (
          <button
            type="button"
            onClick={onDone}
            disabled={busy}
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-40"
          >
            I&apos;m done
          </button>
        )}
      </div>
    </div>
  );
}

// --- bits ------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

function SaveWarning({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Couldn&apos;t save that one — you can keep going and set it later from
      settings.
    </p>
  );
}
