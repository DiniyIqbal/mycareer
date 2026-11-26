"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { NOTE_MAX, splitMentions, type Mentionable } from "@/lib/notes/mentions";
import { addNote, deleteNote, updateNote, type NoteResult } from "./notes-actions";

export type NoteView = {
  id: string;
  authorName: string;
  mine: boolean;
  body: string;
  mentions: string[];
  createdLabel: string;
  edited: boolean;
};

export function Notes({ applicationId, notes, members }: {
  applicationId: string;
  notes: NoteView[];
  members: Mentionable[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div className="space-y-4">
      {notes.length === 0 && <p className="text-sm text-zinc-500">No notes yet.</p>}
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <p className="mb-1 text-xs text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{n.authorName}</span> · {n.createdLabel}
              {n.edited && " · edited"}
            </p>
            {editing === n.id ? (
              <NoteEditor members={members} initialBody={n.body} initialMentions={n.mentions} submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(body, mentions) => updateNote({ noteId: n.id, body, mentions })}
                onDone={() => setEditing(null)} />
            ) : (
              <>
                <p className="whitespace-pre-line break-words">
                  {splitMentions(n.body, n.mentions.map((id) => nameById.get(id) ?? "")).map((part, i) =>
                    part.mention ? (
                      <span key={i} className="rounded bg-sky-100 px-0.5 font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">{part.text}</span>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </p>
                {n.mine && <NoteActions noteId={n.id} onEdit={() => setEditing(n.id)} />}
              </>
            )}
          </li>
        ))}
      </ul>
      <NoteEditor members={members} initialBody="" initialMentions={[]} submitLabel="Add note"
        onSubmit={(body, mentions) => addNote({ applicationId, body, mentions })} />
    </div>
  );
}

function NoteActions({ noteId, onEdit }: { noteId: string; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex gap-3 text-xs">
      <button type="button" className="underline" onClick={onEdit}>Edit</button>
      <button type="button" className="text-red-700 underline dark:text-red-400" disabled={pending}
        onClick={() => {
          if (!confirm("Delete this note?")) return;
          start(async () => {
            const r = await deleteNote({ noteId });
            if (!r.ok) setError(r.error);
          });
        }}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span role="alert" className="text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}

/** Textarea with an @mention picker (type @ then a name; arrows + Enter to pick). */
function NoteEditor({ members, initialBody, initialMentions, submitLabel, onSubmit, onCancel, onDone }: {
  members: Mentionable[];
  initialBody: string;
  initialMentions: string[];
  submitLabel: string;
  onSubmit: (body: string, mentions: string[]) => Promise<NoteResult>;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<string[]>(initialMentions);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const matches = query
    ? members.filter((m) => m.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6)
    : [];
  const open = matches.length > 0;

  function detect(value: string, caret: number) {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return setQuery(null);
    const text = before.slice(at + 1);
    if (text.length > 40 || text.includes("\n")) return setQuery(null);
    setQuery({ text, start: at });
    setActive(0);
  }

  function pick(m: Mentionable) {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart;
    const next = `${body.slice(0, query.start)}@${m.name} ${body.slice(caret)}`;
    setBody(next);
    setMentions((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
    setQuery(null);
    const pos = query.start + m.name.length + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  }

  function submit() {
    if (!body.trim()) return;
    start(async () => {
      const r = await onSubmit(body, mentions);
      if (!r.ok) return setMessage({ tone: "error", text: r.error });
      setMessage(r.warning ? { tone: "warning", text: r.warning } : null);
      if (onDone) {
        if (!r.warning) onDone();
      } else {
        setBody("");
        setMentions([]);
      }
    });
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{submitLabel === "Save" ? "Edit note" : "New note"}</label>
      <textarea ref={ref} id={id} value={body} rows={3} maxLength={NOTE_MAX}
        placeholder="Add a note. Type @ to mention a colleague."
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onChange={(e) => { setBody(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      {open && (
        <ul id={`${id}-list`} role="listbox"
          className="absolute z-10 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {matches.map((m, i) => (
            <li key={m.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              className="cursor-pointer px-3 py-2 aria-selected:bg-zinc-100 dark:aria-selected:bg-zinc-800">
              {m.name}
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"}
          className={`mt-1 text-xs ${message.tone === "error" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
          {message.text}
        </p>
      )}
      <div className="mt-2 flex gap-3">
        <button type="button" onClick={submit} disabled={pending || !body.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm underline">Cancel</button>}
      </div>
    </div>
  );
}
