"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SECTIONS, type Question } from "@/lib/onboarding-questions";

// The onboarding interview, re-rendered as one editable page instead of a
// wizard. Same question definitions, same API route — this is meant to be
// the thing you come back to when your focus changes or you want to add
// the optional sections you skipped the first time, not a separate form
// that could drift out of sync with what onboarding actually asks.

type FormValues = Record<string, string | string[]>;
type SaveState = "idle" | "loading" | "saving" | "saved" | "error";

// list/multi fields store arrays server-side but a textarea/checkbox
// group needs a starting shape — this fills in the empty case so every
// field has *something* to render against before the fetch returns.
function emptyValue(question: Question): string | string[] {
  return question.kind === "list" || question.kind === "multi" ? [] : "";
}

function valuesFromProfile(
  profile: Record<string, unknown> | null
): FormValues {
  const values: FormValues = {};
  for (const section of SECTIONS) {
    for (const question of section.questions) {
      const raw = profile?.[question.field];
      if (question.kind === "list" || question.kind === "multi") {
        values[question.field] = Array.isArray(raw) ? (raw as string[]) : [];
      } else {
        values[question.field] = typeof raw === "string" ? raw : "";
      }
      if (question.otherField) {
        const other = profile?.[question.otherField];
        values[question.otherField] = typeof other === "string" ? other : "";
      }
    }
  }
  return values;
}

export default function ProfileSettingsForm() {
  const [state, setState] = useState<SaveState>("loading");
  const [values, setValues] = useState<FormValues>({});
  // Not an interview question — a preference the chat card also toggles —
  // so it's held beside the question-driven values rather than folded
  // into them, and rides along in the same PATCH.
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const body = (await res.json()) as { profile: Record<string, unknown> | null };
        if (!cancelled) {
          setValues(valuesFromProfile(body.profile));
          setVoiceReplies(body.profile?.voice_replies === true);
          setState("idle");
        }
      } catch {
        if (!cancelled) {
          // Still show the form on a failed load — empty fields you can
          // fill in and save beat a dead end, and the row gets created on
          // first save either way.
          setValues(valuesFromProfile(null));
          setState("idle");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = (field: string, value: string | string[]) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    setState("saving");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: {
            ...values,
            voice_replies: voiceReplies,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("saved");
      // Drops back to idle so a second edit doesn't sit under a stale
      // "Saved" label.
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2500);
    } catch {
      setState("error");
      setErrorMessage("Couldn't save just now — try again in a moment.");
    }
  };

  const [core, ...optional] = SECTIONS;

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            What Nexus knows about you
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Change any of this whenever you like — your brief updates the
            next time it runs.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-neutral-400 transition-colors hover:text-neutral-600"
        >
          Back to dashboard
        </Link>
      </div>

      {state === "loading" ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="h-4 w-2/5 animate-pulse rounded bg-neutral-100" />
          <div className="mt-4 space-y-3">
            <div className="h-10 w-full animate-pulse rounded-xl bg-neutral-100" />
            <div className="h-10 w-full animate-pulse rounded-xl bg-neutral-100" />
          </div>
        </div>
      ) : (
        <>
          <SectionCard
            title={core.title}
            description="These shape every brief."
            questions={core.questions}
            values={values}
            setField={setField}
          />

          {optional.map((section) => (
            <SectionCard
              key={section.id}
              title={section.title}
              description={section.pitch}
              questions={section.questions}
              values={values}
              setField={setField}
            />
          ))}

          <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-neutral-900">Voice</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              How Nexus sounds when you talk to it in chat.
            </p>

            <label className="mt-5 flex items-start gap-3">
              <input
                type="checkbox"
                checked={voiceReplies}
                onChange={(e) => setVoiceReplies(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-400"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-800">
                  Read replies aloud
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  Chat answers are spoken by your browser. The mic button for
                  asking by voice is always there — this only controls whether
                  Nexus talks back.
                </span>
              </span>
            </label>
          </section>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={state === "saving"}
              className="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "saving" ? "Saving…" : "Save changes"}
            </button>
            {state === "saved" && (
              <span className="text-sm text-emerald-600">Saved.</span>
            )}
            {state === "error" && (
              <span className="text-sm text-red-600">{errorMessage}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  questions,
  values,
  setField,
}: {
  title: string;
  description?: string;
  questions: Question[];
  values: FormValues;
  setField: (field: string, value: string | string[]) => void;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      {description && (
        <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
      )}

      <div className="mt-5 space-y-5">
        {questions.map((question) => (
          <FieldEditor
            key={question.field}
            question={question}
            value={values[question.field] ?? emptyValue(question)}
            otherValue={
              question.otherField
                ? (values[question.otherField] as string | undefined) ?? ""
                : undefined
            }
            onChange={(value) => setField(question.field, value)}
            onOtherChange={
              question.otherField
                ? (other) => setField(question.otherField as string, other)
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

function FieldEditor({
  question,
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  question: Question;
  value: string | string[];
  otherValue?: string;
  onChange: (value: string | string[]) => void;
  onOtherChange?: (value: string) => void;
}) {
  // list fields are edited as one-per-line text and split/joined at the
  // boundary — same convention the onboarding wizard uses, so an answer
  // given in one place reads identically in the other.
  const listText = useMemo(
    () => (Array.isArray(value) ? value.join("\n") : ""),
    [value]
  );

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-800">
        {question.prompt}
      </label>
      {question.help && (
        <p className="mt-0.5 text-xs text-neutral-500">{question.help}</p>
      )}

      <div className="mt-2">
        {question.kind === "text" && (
          <input
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder}
            className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
          />
        )}

        {question.kind === "time" && (
          <input
            type="time"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-indigo-400"
          />
        )}

        {(question.kind === "textarea" || question.kind === "list") && (
          <textarea
            value={question.kind === "list" ? listText : (value as string)}
            onChange={(e) =>
              onChange(
                question.kind === "list"
                  ? e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                  : e.target.value
              )
            }
            rows={question.kind === "list" ? 3 : 3}
            placeholder={question.placeholder}
            className="w-full resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
          />
        )}

        {question.kind === "choice" && (
          <div className="flex flex-wrap gap-2">
            {(question.options ?? []).map((option) => {
              const selected = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange(selected ? "" : option.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        {question.kind === "choice" &&
          question.otherField &&
          value === "other" && (
            <input
              value={otherValue ?? ""}
              onChange={(e) => onOtherChange?.(e.target.value)}
              placeholder="What field is it?"
              className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400"
            />
          )}

        {question.kind === "multi" && (
          <div className="flex flex-wrap gap-2">
            {(question.options ?? []).map((option) => {
              const list = Array.isArray(value) ? value : [];
              const selected = list.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    onChange(
                      selected
                        ? list.filter((v) => v !== option.value)
                        : [...list, option.value]
                    )
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
