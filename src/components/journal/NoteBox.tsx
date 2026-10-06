import { useEffect, useRef, useState } from "react";
import type { JournalNote } from "../../types";
import { cn } from "../../lib/utils";
import { setJournalNote } from "../../lib/db";
import { SUGGESTED_TAGS, MISTAKE_TAGS, parseTags } from "../../lib/journal";

interface NoteBoxProps {
  label: string;
  portfolioId: number;
  noteKey: string;
  note: JournalNote | undefined;
  onSaved: () => void;
  withLesson?: boolean;
  withTags?: boolean;
  className?: string;
}

export function NoteBox({
  label, portfolioId, noteKey, note, onSaved, withLesson, withTags, className,
}: NoteBoxProps) {
  const [reflection, setReflection] = useState(note?.reflection ?? "");
  const [lesson, setLesson] = useState(note?.lesson ?? "");
  const [tags, setTags] = useState(note?.tags ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    reflection !== (note?.reflection ?? "") ||
    lesson !== (note?.lesson ?? "") ||
    tags !== (note?.tags ?? "");

  // Latest values for the unmount flush, which can't see fresh state.
  const latest = useRef({ reflection, lesson, tags, dirty });
  latest.current = { reflection, lesson, tags, dirty };

  // Autosave shortly after typing stops, so a note is never lost to a
  // forgotten Save click.
  useEffect(() => {
    if (!dirty) return;
    setStatus("idle");
    const timer = setTimeout(async () => {
      setStatus("saving");
      setError(null);
      try {
        await setJournalNote(portfolioId, noteKey, reflection, lesson, tags);
        setStatus("saved");
        onSaved();
      } catch (e) {
        setStatus("idle");
        setError(String(e));
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflection, lesson, tags]);

  // Leaving the screen (or switching trade) inside the debounce window.
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty) {
        void setJournalNote(portfolioId, noteKey, l.reflection, l.lesson, l.tags).then(
          onSaved,
          () => {},
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const current = parseTags(tags);
  function toggleTag(t: string) {
    setTags(current.includes(t) ? current.filter((x) => x !== t).join(", ") : [...current, t].join(", "));
  }

  const area = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y min-h-[80px]";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      <textarea
        className={area}
        placeholder={withLesson ? "What was the thesis? How did you execute?" : "How did the day go?"}
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
      />
      {withLesson && (
        <textarea
          className={area}
          placeholder="What would you do differently next time?"
          value={lesson}
          onChange={(e) => setLesson(e.target.value)}
        />
      )}
      {withTags && (
        <>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Tags, comma separated"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_TAGS.map((t) => {
              const on = current.includes(t);
              const mistake = MISTAKE_TAGS.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border transition-colors",
                    on && !mistake && "bg-primary text-primary-foreground border-primary",
                    on && mistake && "bg-negative text-primary-foreground border-negative",
                    !on && "border-border text-muted-foreground hover:bg-muted",
                  )}
                  title={mistake ? "Counted as a mistake in Reports" : undefined}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </>
      )}
      <span className="text-xs text-muted-foreground">
        {error ? (
          <span className="text-negative">Couldn't save: {error}</span>
        ) : status === "saving" ? (
          "Saving…"
        ) : dirty ? (
          "Unsaved changes…"
        ) : status === "saved" || note ? (
          "Saved"
        ) : (
          "Notes save automatically"
        )}
      </span>
    </div>
  );
}
