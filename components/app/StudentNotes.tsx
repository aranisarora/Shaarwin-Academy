"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addStudentNote } from "@/app/coach/players/[playerId]/actions";
import { formatDateFull } from "@/lib/academy-time";

type Note = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
};

export function StudentNotes({
  playerId,
  authorName,
  notes,
}: {
  playerId: string;
  authorName: string;
  notes: Note[];
}) {
  const [rows, setRows] = useState<Note[]>(notes);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAdd() {
    const body = draft.trim();
    if (!body) return;
    setMessage(null);

    const optimistic: Note = {
      id: `temp-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      author: authorName,
    };
    setRows((r) => [optimistic, ...r]);
    setDraft("");

    startTransition(async () => {
      const result = await addStudentNote(playerId, body);
      if (!result.ok) {
        setRows((r) => r.filter((n) => n.id !== optimistic.id));
        setDraft(body);
        setMessage(result.error ?? "Couldn’t save the note.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="new-note" className="label mb-2 block">
          Add a note
        </label>
        <textarea
          id="new-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Progress, focus areas, wins — the family reads this too."
          className="w-full rounded-[8px] border border-line bg-surface-2 p-3.5 text-base"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button disabled={pending || !draft.trim()} onClick={onAdd}>
            Save note
          </Button>
          <span className="text-xs text-fg-2">
            Visible to the player&apos;s family, all coaches, and the founder.
          </span>
        </div>
        {message && <p className="mt-2 text-sm text-fg-2">{message}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-2">No notes yet — add the first one.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((n) => (
            <li
              key={n.id}
              className="rounded-[12px] border border-line bg-surface-2 px-4 py-3"
            >
              <p className="tnum mb-1 text-xs text-fg-2">
                {formatDateFull(n.createdAt)} · {n.author}
              </p>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
