"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

/** Free-form tag entry (Enter / comma to add, Backspace to remove the last tag). */
export function TagInput({ id, value, onChange, max = 40, maxLength = 60, placeholder, suggestions = [] }: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = raw.trim().slice(0, maxLength);
    if (!t || value.length >= max || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
      setDraft("");
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div>
      <div className="input flex min-h-[2.6rem] flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold-strong">
            {t}
            <button type="button" aria-label={`Remove ${t}`} className="rounded-full hover:bg-black/10" onClick={() => onChange(value.filter((v) => v !== t))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          value={draft}
          maxLength={maxLength}
          placeholder={value.length >= max ? `Maximum ${max}` : placeholder}
          disabled={value.length >= max}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (draft.trim()) {
              add(draft);
              setDraft("");
            }
          }}
        />
      </div>
      {remaining.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remaining.slice(0, 10).map((s) => (
            <button key={s} type="button" className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-gold hover:text-text" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
